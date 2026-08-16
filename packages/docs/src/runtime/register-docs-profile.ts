import type { FastifyInstance } from "fastify";
import { fastifyPlugin } from "inngest/fastify";
import { inngest } from "./inngest/client.js";
import { inngestFunctions } from "./inngest/index.js";
import { logInfo } from "./lib/logger.js";
import rerankRequestContextMiddleware from "./middleware/rerank-request-context.js";
import chatThinkingRequestMiddleware from "./middleware/chat-thinking-request.js";
import chatUserRequestContextMiddleware from "./middleware/chat-user-request-context.js";
import { healthRoutes } from "./routes/health.js";
import { projectRoutes } from "./routes/projects.js";
import { sourceRoutes } from "./routes/sources.js";
import { crawlRunRoutes } from "./routes/crawl-runs.js";
import { indexingRoutes } from "./routes/indexing.js";
import { ingestRoutes } from "./routes/ingest.js";
import { refreshRoutes } from "./routes/refresh.js";
import { preflightRoutes } from "./routes/preflight.js";
import { apiKeyRoutes } from "./routes/api-keys.js";
import { accessRoutes } from "./routes/access.js";
import { chatRoutes } from "./routes/chat.js";
import { crawlFilterRoutes } from "./routes/crawl-filter.js";
import { sourceSetRoutes } from "./routes/source-sets.js";
import { billingRoutes } from "./routes/billing.js";
import { repoProfileRoutes } from "./routes/repo-profile.js";

/**
 * Docs profile: ingest, sources, chat, MCP routes (Mastra mounts at server level).
 * Hosted entry adds auth + Inngest + OAuth in {@link registerHostedExtensions}.
 */
export async function registerDocsProfile(fastify: FastifyInstance): Promise<void> {
  await fastify.register(rerankRequestContextMiddleware);
  await fastify.register(chatThinkingRequestMiddleware);
  await fastify.register(chatUserRequestContextMiddleware);
  await fastify.register(healthRoutes);
  await fastify.register(projectRoutes);
  await fastify.register(sourceRoutes);
  await fastify.register(crawlRunRoutes);
  await fastify.register(indexingRoutes);
  await fastify.register(ingestRoutes);
  await fastify.register(refreshRoutes);
  await fastify.register(preflightRoutes);
  await fastify.register(apiKeyRoutes);
  await fastify.register(accessRoutes);
  await fastify.register(chatRoutes);
  await fastify.register(crawlFilterRoutes);
  await fastify.register(sourceSetRoutes);
  await fastify.register(billingRoutes);
  await fastify.register(repoProfileRoutes);
}

export async function registerHostedInngest(fastify: FastifyInstance): Promise<void> {
  logInfo("Registering Inngest plugin", "Server", {
    hasSigningKey: Boolean(process.env.INNGEST_SIGNING_KEY),
    hasEventKey: Boolean(process.env.INNGEST_EVENT_KEY),
    functionCount: inngestFunctions.length,
  });

  await fastify.register(fastifyPlugin, {
    client: inngest,
    functions: inngestFunctions,
  });
}
