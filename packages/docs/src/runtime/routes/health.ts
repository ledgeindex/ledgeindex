import type { FastifyInstance } from "fastify";
import { LEDGEINDEX_CORE_VERSION } from "@ledgeindex/core";
import { isLocalHostingDeployment } from "../db/types.js";
import { inspectDbHealth } from "../db/db-health.js";
import { describeLlmSetup, hasLlmKey } from "../llm/models.js";
import { isApiAuthRequired } from "../lib/firebase-admin.js";
import { getMcpHttpPath } from "../mastra/mcp/config.js";
import { tryGetMastra } from "../mastra/instance.js";
import { describeRerankSetup } from "../retrieval/rerank-backend.js";

export async function healthRoutes(fastify: FastifyInstance) {
  fastify.get("/health", async () => ({
    status: "ok",
    service: "ledgeindex-api",
    packages: {
      "@ledgeindex/core": LEDGEINDEX_CORE_VERSION,
    },
    timestamp: new Date().toISOString(),
    hosting: {
      /** Dev / self-host / desktop sidecar can create local indexes. */
      localAvailable: isLocalHostingDeployment(),
      /** Cloud indexes are always available (prod) or via remote API (desktop). */
      cloudAvailable: true,
      default: isLocalHostingDeployment() ? "local" : "cloud",
    },
    llm: {
      agentReady: hasLlmKey(),
      ...describeLlmSetup(),
    },
    rerank: describeRerankSetup(),
    chat: {
      docsAgent: "/chat/docsAgent",
      modelTestAgent: "/chat/modelTestAgent",
      exploreAgent: "/chat/exploreAgent",
    },
    mastra: (() => {
      const mastra = tryGetMastra();
      if (!mastra) {
        return {
          ready: false,
          agents: [],
          workflows: [],
          mcp: { httpPath: getMcpHttpPath() },
        };
      }
      return {
        ready: true,
        agents: Object.keys(mastra.listAgents()),
        workflows: Object.keys(mastra.listWorkflows()),
        mcp: {
          url: getMcpHttpPath(),
          ...(isApiAuthRequired()
            ? {
                oauth: "/.well-known/oauth-authorization-server",
                connect: "/oauth/authorize",
              }
            : { auth: "none" }),
        },
      };
    })(),
  }));

  fastify.get("/health/db", async () => {
    const db = await inspectDbHealth();
    return {
      status: db.postgresReachable && db.allMigrationsReady ? "ok" : "degraded",
      service: "ledgeindex-api",
      timestamp: new Date().toISOString(),
      db,
    };
  });
}
