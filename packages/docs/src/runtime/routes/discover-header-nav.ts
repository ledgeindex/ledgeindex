import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { normalizeStartUrl } from "../lib/url.js";
import {
  discoverHeaderNavPaths,
  listHeaderNavProviders,
} from "../crawler/discover-header-nav.js";
import {
  ensureStagehandRuntime,
  getStagehandRuntimeStatus,
} from "../crawler/stagehand-runtime.js";

const bodySchema = z.object({
  url: z.string().min(1),
  provider: z.enum(["google", "openai", "deepseek"]).optional(),
  browserRuntime: z.enum(["playwright", "system"]).optional(),
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
      const status = /Chromium install failed|playwright-core is missing/i.test(
        message,
      )
        ? 503
        : 502;
      return reply.status(status).send({ error: message });
    }
  });

  fastify.post("/api/discover-header-nav", async (request, reply) => {
    const { url: rawUrl, provider, browserRuntime = "playwright" } =
      bodySchema.parse(request.body);
    const url = normalizeStartUrl(rawUrl);

    try {
      new URL(url);
    } catch {
      return reply.status(400).send({ error: "Invalid URL" });
    }

    try {
      const result = await discoverHeaderNavPaths(url, provider, browserRuntime);
      return result;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Header nav discovery failed";
      const status =
        /Chromium install failed|playwright-core is missing|Browser runtime not installed|No installed Chrome/i.test(
          message,
        )
          ? 503
          : /not installed|api key missing|needs a .+ key|Stagehand is not available/i.test(
                message,
              )
            ? 501
            : 502;
      return reply.status(status).send({ error: message });
    }
  });
}
