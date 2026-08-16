import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { runWithRetrievalContext } from "@ledgeindex/core/query/rerank-request-context.js";
import { findExamples } from "../retrieval/find-examples.js";
import { logError } from "../lib/logger.js";
import { getSourceForUser, requireUser } from "../lib/resource-access.js";
import { askSource } from "../services/source-ask.js";

const rerankBackendSchema = z.enum([
  "cohere",
  "cohere-auto",
  "cohere-v4-fast",
  "local-v2",
  "local-auto",
  "local-mini",
  "local-mini-l12",
  "vector",
  "llm-batch",
  "cohere-mastra",
]);

const askBodySchema = z.object({
  message: z.string().min(1).max(4000),
  /** retrieve-only — evidence hits for MCP/explore; agent — synthesize (default). */
  mode: z.enum(["agent", "retrieve-only"]).optional(),
  rerankBackend: rerankBackendSchema.optional(),
  model: z
    .object({
      backend: z.string().min(1),
      modelId: z.string().min(1).optional(),
      baseUrl: z.string().min(1).optional(),
      googleModelId: z.string().min(1).optional(),
    })
    .optional(),
});

const findExamplesBodySchema = z.object({
  query: z.string().min(1).max(4000),
  kind: z.enum(["code", "setup", "usage", "config", "other"]).optional(),
  language: z.string().min(1).max(64).optional(),
  topK: z.number().int().positive().max(32).optional(),
  rerankBackend: rerankBackendSchema.optional(),
});

export async function chatRoutes(fastify: FastifyInstance) {
  fastify.post("/api/sources/:id/ask", async (request, reply) => {
    const userId = await requireUser(request, reply);
    if (!userId) return;

    const { id } = request.params as { id: string };
    const source = await getSourceForUser(id, userId);
    if (!source) {
      return reply.status(404).send({ error: "Source not found" });
    }

    const body = askBodySchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: body.error.flatten() });
    }

    try {
      const result = await askSource(source.id, body.data.message, {
        ...(body.data.mode ? { mode: body.data.mode } : {}),
        ...(body.data.rerankBackend
          ? { rerankBackend: body.data.rerankBackend }
          : {}),
        ...(body.data.model ? { model: body.data.model } : {}),
        sourceScope: source.scope === "global" ? "global" : "personal",
        sourceHosting:
          source.hosting === "cloud" || source.scope === "global"
            ? "cloud"
            : source.hosting === "local"
              ? "local"
              : source.scope === "global"
                ? "cloud"
                : "local",
      });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Ask failed";
      logError(error instanceof Error ? error : message, "SourceAsk", {
        sourceId: id,
      });
      return reply.status(500).send({ error: message });
    }
  });

  fastify.post("/api/sources/:id/find-examples", async (request, reply) => {
    const userId = await requireUser(request, reply);
    if (!userId) return;

    const { id } = request.params as { id: string };
    const source = await getSourceForUser(id, userId);
    if (!source) {
      return reply.status(404).send({ error: "Source not found" });
    }

    const body = findExamplesBodySchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: body.error.flatten() });
    }

    try {
      const result = await runWithRetrievalContext(
        {
          backend: body.data.rerankBackend,
          sourceScope: source.scope === "global" ? "global" : "personal",
          sourceHosting:
            source.hosting === "cloud" || source.scope === "global"
              ? "cloud"
              : "local",
        },
        () =>
          findExamples({
            sourceId: source.id,
            query: body.data.query,
            ...(body.data.kind ? { kind: body.data.kind } : {}),
            ...(body.data.language ? { language: body.data.language } : {}),
            ...(typeof body.data.topK === "number"
              ? { topK: body.data.topK }
              : {}),
          }),
      );
      return {
        sourceId: source.id,
        ...result,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Find examples failed";
      logError(error instanceof Error ? error : message, "FindExamples", {
        sourceId: id,
      });
      return reply.status(500).send({ error: message });
    }
  });
}
