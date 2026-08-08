import type { FastifyPluginAsync } from "fastify";
import {
  isRequestRerankBackend,
  isSourceHosting,
  isSourceScope,
  setRequestRerankBackend,
  setRequestSourceHosting,
  setRequestSourceScope,
} from "../retrieval/rerank-request-context.js";

/**
 * Reads chat `requestContext` so retrieve uses the right stack:
 * - source_hosting=cloud (or source_scope=global) → Gemini + pgvector + Cohere Auto
 * - source_hosting=local / personal local → LibSQL + FastEmbed; rerank_backend override for A/B
 * Local APIs must not set POSTGRES_CONNECTION_STRING to production.
 */
const rerankRequestContextPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("preHandler", async (request) => {
    if (request.method !== "POST" || !request.url.startsWith("/chat/")) {
      return;
    }

    const body = request.body as
      | { requestContext?: Record<string, unknown> }
      | undefined;
    const ctx = body?.requestContext;
    if (!ctx) return;

    const hosting = ctx.source_hosting;
    if (isSourceHosting(hosting)) {
      setRequestSourceHosting(hosting);
      if (hosting === "cloud") {
        setRequestRerankBackend("cohere-auto");
      }
    }

    const scope = ctx.source_scope;
    if (isSourceScope(scope)) {
      setRequestSourceScope(scope);
      if (scope === "global" && !isSourceHosting(hosting)) {
        setRequestSourceHosting("cloud");
        setRequestRerankBackend("cohere-auto");
        return;
      }
      if (hosting === "cloud" || scope === "global") {
        return;
      }
    } else if (hosting === "cloud") {
      return;
    }

    const backend = ctx.rerank_backend;
    if (isRequestRerankBackend(backend)) {
      setRequestRerankBackend(backend);
    }
  });
};

export default rerankRequestContextPlugin;
