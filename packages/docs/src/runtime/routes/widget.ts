import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { logError } from "../lib/logger.js";
import { getSourceForUser, requireUser } from "../lib/resource-access.js";
import { askSourceStream } from "../services/source-ask.js";
import {
  enforceWidgetAbuseLimits,
  pruneWidgetRateBuckets,
  widgetClientIp,
} from "../services/widget-abuse.js";
import {
  createWidgetIntegration,
  deleteWidgetIntegration,
  getWidgetIntegration,
  isOriginAllowed,
  listWidgetIntegrations,
  normalizeAllowedOrigins,
  updateWidgetIntegration,
  type WidgetIntegration,
} from "../services/widget-integration-store.js";

const brandSchema = z.object({
  projectName: z.string().min(1).max(120).optional(),
  projectColor: z.string().min(1).max(32).optional(),
  projectLogo: z.string().url().nullable().optional(),
});

const createSchema = z.object({
  name: z.string().min(1).max(120),
  sourceIds: z.array(z.string().min(1)).min(1).max(8),
  allowedOrigins: z.array(z.string().min(1)).min(1).max(32),
  brand: brandSchema.optional(),
});

const updateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  sourceIds: z.array(z.string().min(1)).min(1).max(8).optional(),
  allowedOrigins: z.array(z.string().min(1)).min(1).max(32).optional(),
  brand: brandSchema.optional(),
  status: z.enum(["active", "disabled"]).optional(),
});

const chatSchema = z.object({
  websiteId: z.string().min(1),
  message: z.string().min(1).max(4000),
  /** Optional override when integration has multiple sources (must be bound). */
  sourceId: z.string().min(1).optional(),
});

function publicWidgetView(row: WidgetIntegration) {
  return {
    websiteId: row.websiteId,
    name: row.name,
    brand: row.brand,
    status: row.status,
    sourceIds: row.sourceIds,
    allowedOrigins: row.allowedOrigins,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function requestOrigin(request: FastifyRequest): string | null {
  const origin = request.headers.origin;
  if (typeof origin === "string" && origin.trim()) return origin.trim();
  return null;
}

function requestReferer(request: FastifyRequest): string | null {
  const referer = request.headers.referer ?? request.headers.referrer;
  if (typeof referer === "string" && referer.trim()) return referer.trim();
  return null;
}

function setWidgetCors(reply: FastifyReply, origin: string | null): void {
  if (!origin) return;
  reply.header("Access-Control-Allow-Origin", origin);
  reply.header("Vary", "Origin");
  reply.header("Access-Control-Allow-Methods", "POST, OPTIONS");
  reply.header("Access-Control-Allow-Headers", "Content-Type");
}

type WidgetSseEvent =
  | { type: "token"; text: string }
  | {
      type: "done";
      citations: Array<{ name: string; url: string }>;
      insufficient: boolean;
      websiteId: string;
      sourceId: string;
    }
  | { type: "error"; error: string };

function writeSse(reply: FastifyReply, event: WidgetSseEvent): void {
  reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
  const raw = reply.raw as NodeJS.WritableStream & { flush?: () => void };
  raw.flush?.();
}

export async function widgetRoutes(fastify: FastifyInstance) {
  fastify.options("/api/widget/chat", async (request, reply) => {
    const origin = requestOrigin(request);
    setWidgetCors(reply, origin);
    return reply.code(204).send();
  });

  /** Public chat — domain-checked via websiteId (no live_ key). SSE token stream. */
  fastify.post("/api/widget/chat", async (request, reply) => {
    const origin = requestOrigin(request);
    const referer = requestReferer(request);
    setWidgetCors(reply, origin);

    const body = chatSchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: body.error.flatten() });
    }

    const integration = await getWidgetIntegration(body.data.websiteId);
    if (!integration || integration.status !== "active") {
      return reply.status(404).send({ error: "Widget not found" });
    }

    const requireOriginHeader = process.env.NODE_ENV === "production";
    if (
      !isOriginAllowed(integration.allowedOrigins, origin, referer, {
        requireOriginHeader,
      })
    ) {
      return reply.status(403).send({
        error: requireOriginHeader && !origin
          ? "Origin header required"
          : "Origin not allowed for this widget",
      });
    }

    // Normalized origin used for limits (always present when allowlist passed in prod).
    const allowedOrigin =
      (origin && origin.trim()) ||
      (referer ? referer.trim() : "") ||
      "unknown";

    pruneWidgetRateBuckets();
    const abuse = enforceWidgetAbuseLimits({
      websiteId: integration.websiteId,
      origin: allowedOrigin,
      clientIp: widgetClientIp(request),
    });
    if (!abuse.ok) {
      return reply.status(abuse.status).send({ error: abuse.error });
    }

    const sourceId =
      body.data.sourceId && integration.sourceIds.includes(body.data.sourceId)
        ? body.data.sourceId
        : integration.sourceIds[0];
    if (!sourceId) {
      return reply.status(400).send({ error: "Widget has no bound source" });
    }

    const source = await getSourceForUser(sourceId, integration.ownerUserId);
    if (!source) {
      return reply.status(404).send({ error: "Bound source not found" });
    }

    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      ...(origin
        ? {
            "Access-Control-Allow-Origin": origin,
            Vary: "Origin",
          }
        : {}),
    });

    try {
      const result = await askSourceStream(
        source.id,
        body.data.message,
        {
          mode: "agent",
          sourceScope: source.scope === "global" ? "global" : "personal",
          sourceHosting:
            source.hosting === "cloud" || source.scope === "global"
              ? "cloud"
              : source.hosting === "local"
                ? "local"
                : "cloud",
          abortSignal: request.raw.signal,
        },
        {
          onToken: (text) => {
            writeSse(reply, { type: "token", text });
          },
        },
      );

      writeSse(reply, {
        type: "done",
        citations: result.citations.map((c) => ({
          name: c.name,
          url: c.url,
        })),
        insufficient: result.insufficient,
        websiteId: integration.websiteId,
        sourceId: source.id,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Ask failed";
      logError(error instanceof Error ? error : message, "WidgetChat", {
        websiteId: integration.websiteId,
        sourceId: source.id,
      });
      writeSse(reply, { type: "error", error: message });
    } finally {
      reply.raw.end();
    }
  });

  /** Public brand defaults for the loader (optional). */
  fastify.get("/api/widget/:websiteId/config", async (request, reply) => {
    const { websiteId } = request.params as { websiteId: string };
    const origin = requestOrigin(request);
    const referer = requestReferer(request);
    setWidgetCors(reply, origin);

    const integration = await getWidgetIntegration(websiteId);
    if (!integration || integration.status !== "active") {
      return reply.status(404).send({ error: "Widget not found" });
    }
    if (!isOriginAllowed(integration.allowedOrigins, origin, referer)) {
      return reply.status(403).send({ error: "Origin not allowed for this widget" });
    }

    return {
      websiteId: integration.websiteId,
      brand: integration.brand,
    };
  });

  fastify.get("/api/widget/integrations", async (request, reply) => {
    const userId = await requireUser(request, reply);
    if (!userId) return;
    const data = await listWidgetIntegrations(userId);
    return { success: true, data: data.map(publicWidgetView) };
  });

  fastify.post("/api/widget/integrations", async (request, reply) => {
    const userId = await requireUser(request, reply);
    if (!userId) return;

    const body = createSchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: body.error.flatten() });
    }

    const origins = normalizeAllowedOrigins(body.data.allowedOrigins);
    if (origins.length === 0) {
      return reply.status(400).send({ error: "At least one valid origin is required" });
    }

    for (const sourceId of body.data.sourceIds) {
      const source = await getSourceForUser(sourceId, userId);
      if (!source) {
        return reply.status(400).send({ error: `Source not found: ${sourceId}` });
      }
    }

    const created = await createWidgetIntegration(userId, {
      name: body.data.name,
      sourceIds: body.data.sourceIds,
      allowedOrigins: origins,
      brand: body.data.brand,
    });

    return reply.status(201).send({
      success: true,
      data: publicWidgetView(created),
    });
  });

  fastify.patch("/api/widget/integrations/:websiteId", async (request, reply) => {
    const userId = await requireUser(request, reply);
    if (!userId) return;

    const { websiteId } = request.params as { websiteId: string };
    const body = updateSchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: body.error.flatten() });
    }

    if (body.data.sourceIds) {
      for (const sourceId of body.data.sourceIds) {
        const source = await getSourceForUser(sourceId, userId);
        if (!source) {
          return reply.status(400).send({ error: `Source not found: ${sourceId}` });
        }
      }
    }

    const updated = await updateWidgetIntegration(userId, websiteId, {
      ...body.data,
      ...(body.data.allowedOrigins
        ? { allowedOrigins: normalizeAllowedOrigins(body.data.allowedOrigins) }
        : {}),
    });
    if (!updated) {
      return reply.status(404).send({ error: "Widget not found" });
    }

    return { success: true, data: publicWidgetView(updated) };
  });

  fastify.delete("/api/widget/integrations/:websiteId", async (request, reply) => {
    const userId = await requireUser(request, reply);
    if (!userId) return;

    const { websiteId } = request.params as { websiteId: string };
    const ok = await deleteWidgetIntegration(userId, websiteId);
    if (!ok) {
      return reply.status(404).send({ error: "Widget not found" });
    }
    return { success: true };
  });
}
