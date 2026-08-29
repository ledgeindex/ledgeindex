import { PinoLogger } from "@mastra/loggers";
import { LibSQLStore } from "@mastra/libsql";
import { PostgresStore } from "@mastra/pg";
import { resolveMastraLogLevel } from "../lib/mastra-log-level.js";
import { dataPath } from "../lib/data-dir.js";
import { docsAgent } from "./agents/docs-agent.js";
import { modelTestAgent } from "./agents/model-test-agent.js";
import { exploreAgent } from "./agents/explore-agent.js";
import { localSourceAgent } from "./agents/local-source-agent.js";
import { ingestWebCrawlWorkflow } from "./workflows/ingest-web-crawl/index.js";
import {
  generateRetrievalGoldenSetWorkflow,
  retrievalEvalWorkflow,
} from "./workflows/retrieval-eval/index.js";
import { getVectorStore } from "../vector/store.js";
import { getPostgresConnectionString } from "../vector/config.js";
import { ledgeindexChatRoute } from "./ledgeindex-chat-route.js";
import { ledgeindexMcpServer } from "./mcp/ledgeindex-mcp-server.js";
import { mcpOAuthDiscoveryMiddleware } from "./mcp/oauth/mcp-oauth-discovery-middleware.js";

function createMastraStorage() {
  const postgresUri = getPostgresConnectionString();
  if (process.env.NODE_ENV === "production" && postgresUri) {
    return new PostgresStore({
      id: "ledgeindex-mastra-storage",
      connectionString: postgresUri,
    });
  }

  return new LibSQLStore({
    id: "ledgeindex-mastra-storage",
    url:
      process.env.LEDGEINDEX_MASTRA_STORAGE_URL ??
      `file:${dataPath("ledgeindex-mastra.db")}`,
  });
}

export function createDocsMastraContribution() {
  return {
    id: "docs",
    agents: {
      docsAgent,
      modelTestAgent,
      exploreAgent,
      localSourceAgent,
    },
    workflows: {
      ingestWebCrawlWorkflow,
      generateRetrievalGoldenSetWorkflow,
      retrievalEvalWorkflow,
    },
    vectors: {
      ledgeindexVector: getVectorStore(),
    },
    storage: createMastraStorage(),
    logger: new PinoLogger({
      name: "ledgeindex",
      level: resolveMastraLogLevel(),
    }),
    mcpServers: {
      ledgeindexMcp: ledgeindexMcpServer,
    },
    server: {
      mcpOptions: {
        serverless: true,
      },
      middleware: [mcpOAuthDiscoveryMiddleware],
      apiRoutes: [
        ledgeindexChatRoute({
          path: "/chat/docsAgent",
          agent: "docsAgent",
          sendSources: true,
          sendReasoning: true,
        }),
        ledgeindexChatRoute({
          path: "/chat/modelTestAgent",
          agent: "modelTestAgent",
          sendReasoning: true,
        }),
        ledgeindexChatRoute({
          path: "/chat/exploreAgent",
          agent: "exploreAgent",
          sendReasoning: true,
        }),
        ledgeindexChatRoute({
          path: "/chat/localSourceAgent",
          agent: "localSourceAgent",
          sendReasoning: true,
        }),
      ],
    },
  };
}
