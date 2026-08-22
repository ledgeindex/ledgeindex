import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { normalizeStartUrl } from "../lib/url.js";
import {
  discoverHeaderNavPaths,
  listHeaderNavProviders,
} from "../crawler/discover-header-nav.js";
import { getStagehandRuntimeStatus, ensureStagehandRuntime } from "../crawler/stagehand-runtime.js";

const bodySchema = z.object({
  url: z.string().min(1),
  provider: z.enum(["google", "openai", "deepseek"]).optional(),
});

export async function discoverHeaderNavRoutes(fastify: FastifyInstance) {
  fastify.get("/api/discover-header-nav", async () => {
    return listHeaderNavProviders();
  });

  fastify.get("/api/discover-header-nav/runtime", async () => {
    return getStagehandRuntimeStatus();
  });

  fastify.post("/api/discover-header-nav/runtime/install", async (_request, reply) => {
    try {
      await ensureStagehandRuntime();
      return getStagehandRuntimeStatus();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Browser runtime install failed";
      const status = /Failed to download Stagehand runtime/i.test(message)
        ? 503
        : 502;
      return reply.status(status).send({ error: message });
    }
  });

  fastify.post("/api/discover-header-nav", async (request, reply) => {
    const { url: rawUrl, provider } = bodySchema.parse(request.body);
    const url = normalizeStartUrl(rawUrl);

    try {
      new URL(url);
    } catch {
      return reply.status(400).send({ error: "Invalid URL" });
    }

    try {
      const result = await discoverHeaderNavPaths(url, provider);
      return result;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Header nav discovery failed";
      const status = /Failed to download Stagehand runtime/i.test(message)
        ? 503
        : /not installed|Browser runtime not installed|api key missing|needs a .+ key/i.test(
              message,
            )
          ? 501
          : 502;
      return reply.status(status).send({ error: message });
    }
  });
}
