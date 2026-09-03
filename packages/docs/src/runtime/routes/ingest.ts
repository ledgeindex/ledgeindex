import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { cancelDiscoverCrawl, getCrawlProgress } from "../crawler/discover.js";
import { cancelIngestForSource, IngestCancelledError } from "../ingest/ingest-cancel.js";
import {
  CRAWL_REVIEW_STEP_ID,
  PARSE_REVIEW_STEP_ID,
  ENRICH_STEP_ID,
  discoveredUrlSchema,
  skippedUrlSchema,
} from "../mastra/workflows/ingest-web-crawl/schemas.js";
import { webCrawlSourceConfigSchema, MAX_CRAWL_PAGES } from "../schemas/source-config.js";
import {
  getIngestWorkflowStatus,
  resumeIngestWorkflow,
  startIngestWorkflow,
} from "../ingest/workflow-runner.js";
import { logError } from "../lib/logger.js";
import { getRequestUserRole, getSourceForUser, getSourceForWrite, requireUser } from "../lib/resource-access.js";

const startBodySchema = z.object({
  config: webCrawlSourceConfigSchema.optional(),
  discoveryResult: z
    .object({
      urls: z.array(discoveredUrlSchema).min(1).max(MAX_CRAWL_PAGES),
      skipped: z.array(skippedUrlSchema).default([]),
      httpStatusFiltered: z.number().int().nonnegative().optional(),
    })
    .optional(),
});

const crawlResumeSchema = z.object({
  step: z.literal(CRAWL_REVIEW_STEP_ID),
  resumeData: z.object({
    selectedUrls: z.array(z.string().url()).min(1).max(MAX_CRAWL_PAGES),
    enrichExamples: z.boolean().optional(),
    enrichBackend: z.string().optional(),
    enrichModelId: z.string().optional(),
    enrichBaseUrl: z.string().optional(),
    enrichGoogleModelId: z.string().optional(),
    enrichContextTokenLimit: z.number().int().positive().optional(),
  }),
});

const parseResumeSchema = z.object({
  step: z.literal(PARSE_REVIEW_STEP_ID),
  resumeData: z.object({
    confirmed: z.literal(true),
    enrichExamples: z.boolean().optional(),
    enrichBackend: z.string().optional(),
    enrichModelId: z.string().optional(),
    enrichBaseUrl: z.string().optional(),
    enrichGoogleModelId: z.string().optional(),
    enrichContextTokenLimit: z.number().int().positive().optional(),
  }),
});

const enrichResumeSchema = z.object({
  step: z.literal(ENRICH_STEP_ID),
  resumeData: z.union([
    z.object({ confirmed: z.literal(true) }),
    z.object({
      action: z.literal("retry_failed"),
      enrichContextTokenLimit: z.number().int().positive().optional(),
    }),
    z.object({
      action: z.literal("retry_urls"),
      urls: z.array(z.string().min(1)).min(1),
      enrichContextTokenLimit: z.number().int().positive().optional(),
    }),
  ]),
});

const resumeBodySchema = z.discriminatedUnion("step", [
  crawlResumeSchema,
  parseResumeSchema,
  enrichResumeSchema,
]);

export async function ingestRoutes(fastify: FastifyInstance) {
  fastify.post("/api/sources/:id/ingest/cancel", async (request, reply) => {
    const userId = await requireUser(request, reply);
    if (!userId) return;

    const role = await getRequestUserRole(request);
    const { id } = request.params as { id: string };
    const source = await getSourceForWrite(id, userId, role);
    if (!source) {
      return reply.status(404).send({ error: "Source not found" });
    }

    cancelIngestForSource(id);
    return { cancelled: true };
  });

  fastify.get("/api/sources/:id/crawl-progress", async (request, reply) => {
    const userId = await requireUser(request, reply);
    if (!userId) return;

    const { id } = request.params as { id: string };
    const source = await getSourceForUser(id, userId);
    if (!source) {
      return reply.status(404).send({ error: "Source not found" });
    }

    const progress = getCrawlProgress(id);
    if (!progress) {
      return { active: false, pagesDiscovered: 0, maxPages: source.config.maxPages };
    }

    return { active: progress.status === "running", ...progress };
  });

  fastify.post("/api/sources/:id/ingest/start", async (request, reply) => {
    const userId = await requireUser(request, reply);
    if (!userId) return;

    const role = await getRequestUserRole(request);
    const { id } = request.params as { id: string };
    const source = await getSourceForWrite(id, userId, role);
    if (!source) {
      return reply.status(404).send({ error: "Source not found" });
    }

    const body = startBodySchema.safeParse(request.body ?? {});
    if (!body.success) {
      return reply.status(400).send({ error: body.error.flatten() });
    }

    const config = body.data.config ?? source.config;

    try {
      const snapshot = await startIngestWorkflow({
        sourceId: id,
        projectId: source.projectId,
        config,
        discoveryResult: body.data.discoveryResult,
      });
      return { snapshot };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to start ingest";
      logError(error instanceof Error ? error : message, "IngestRoutes", {
        sourceId: id,
      });
      return reply.status(500).send({ error: message });
    }
  });

  fastify.post(
    "/api/sources/:id/ingest/:runId/resume",
    async (request, reply) => {
      const userId = await requireUser(request, reply);
      if (!userId) return;

      const role = await getRequestUserRole(request);
      const { id, runId } = request.params as { id: string; runId: string };
      const source = await getSourceForWrite(id, userId, role);
      if (!source) {
        return reply.status(404).send({ error: "Source not found" });
      }

      const body = resumeBodySchema.safeParse(request.body);
      if (!body.success) {
        return reply.status(400).send({ error: body.error.flatten() });
      }

      try {
        const snapshot = await resumeIngestWorkflow({
          runId,
          step: body.data.step,
          resumeData: body.data.resumeData,
        });
        return { snapshot };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to resume ingest";
        if (message.includes("Ingest run not found")) {
          return reply.status(404).send({ error: message });
        }
        if (
          error instanceof IngestCancelledError ||
          /indexing cancelled|ingest cancelled/i.test(message)
        ) {
          return reply.status(499).send({ error: "Indexing cancelled" });
        }
        logError(error instanceof Error ? error : message, "IngestRoutes", {
          sourceId: id,
          runId,
        });
        return reply.status(500).send({ error: message });
      }
    },
  );

  fastify.get(
    "/api/sources/:id/ingest/:runId",
    async (request, reply) => {
      const userId = await requireUser(request, reply);
      if (!userId) return;

      const { id, runId } = request.params as { id: string; runId: string };
      const source = await getSourceForUser(id, userId);
      if (!source) {
        return reply.status(404).send({ error: "Source not found" });
      }

      const snapshot = await getIngestWorkflowStatus(runId);
      if (!snapshot) {
        return reply.status(404).send({ error: "Ingest run not found" });
      }
      return { snapshot };
    },
  );
}
