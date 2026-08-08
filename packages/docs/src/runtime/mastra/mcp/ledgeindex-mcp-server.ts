import { MCPServer } from "@mastra/mcp";
import { LEDGEINDEX_MCP_SERVER_ID } from "./config.js";
import { getMcpAuthContext } from "./mcp-auth-context.js";
import { resolveMcpBearerUser } from "./oauth/resolve-mcp-bearer.js";
import { askKnowledgeSourceTool } from "./tools/ask-knowledge-source-tool.js";
import { getSourceSetTool } from "./tools/get-source-set-tool.js";
import { listPersonalSourcesTool } from "./tools/list-personal-sources-tool.js";
import { listPlatformSourcesTool } from "./tools/list-platform-sources-tool.js";
import { listSourceSetsTool } from "./tools/list-source-sets-tool.js";

export const ledgeindexMcpTools = {
  list_personal_sources: listPersonalSourcesTool,
  list_platform_sources: listPlatformSourcesTool,
  ask_source: askKnowledgeSourceTool,
  list_source_sets: listSourceSetsTool,
  get_source_set: getSourceSetTool,
};

export function createLedgeindexMcpServer() {
  return new MCPServer({
    id: LEDGEINDEX_MCP_SERVER_ID,
    name: "LedgeIndex",
    version: "1.0.0",
    description:
      "LedgeIndex RAG API. Workflow: (1) list_source_sets / get_source_set to pick a member source, (2) ask_source for relevance-pruned evidence hits from that source. Prefer slugs over UUIDs.",
    instructions:
      "Prefer source/set slugs over UUIDs. To query a grouped stack: list_source_sets → get_source_set (see member sources) → ask_source with the chosen source slug. ask_source returns score-pruned retrieval hits (url, title, score, chunk text) — no synthesized answer; reason over the hits yourself. Use list_personal_sources / list_platform_sources when not using a set.",
    tools: ledgeindexMcpTools,
    mapAuthInfoToUser: async ({ authInfo }) => {
      const stored = getMcpAuthContext();
      if (stored?.userId) return { id: stored.userId };

      const info = (authInfo ?? {}) as Record<string, unknown>;
      const token =
        (typeof info.token === "string" && info.token) ||
        (typeof info.accessToken === "string" && info.accessToken) ||
        (typeof info.access_token === "string" && info.access_token) ||
        (typeof (info.extra as Record<string, unknown> | undefined)
          ?.access_token === "string" &&
          ((info.extra as Record<string, unknown>).access_token as string)) ||
        undefined;

      if (token) {
        const user = await resolveMcpBearerUser(token);
        if (user?.id) return { id: user.id };
      }

      const claims = (info.claims ?? info.extra ?? info) as Record<
        string,
        unknown
      >;
      const userId = String(
        claims.sub ?? claims.user_id ?? claims.uid ?? claims.userId ?? "",
      ).trim();
      if (userId) return { id: userId };

      // Desktop sidecar without OAuth — same local owner as REST API.
      if (process.env.LEDGEINDEX_AUTH_REQUIRED !== "1") {
        const localId =
          process.env.LEDGEINDEX_LOCAL_USER_ID?.trim() ||
          "ledgeindex-desktop-local";
        return { id: localId };
      }
      return null;
    },
  });
}

export const ledgeindexMcpServer = createLedgeindexMcpServer();
