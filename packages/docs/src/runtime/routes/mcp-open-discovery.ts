import type { FastifyInstance } from "fastify";
import { isApiAuthRequired } from "../lib/firebase-admin.js";
import {
  getMcpResourceUrl,
  getOAuthProtectedResourceMetadataUrl,
  MCP_OAUTH_SCOPES,
} from "../mastra/mcp/config.js";

/**
 * Local desktop MCP: no OAuth. Cursor probes protected-resource metadata;
 * 404 or broken OAuth discovery leaves "connected" with 0 tools enabled.
 */
export async function registerOpenMcpDiscoveryRoutes(
  fastify: FastifyInstance,
): Promise<void> {
  if (isApiAuthRequired()) return;

  const resourceUrl = getMcpResourceUrl();
  const protectedResourceMetadataPath = new URL(
    getOAuthProtectedResourceMetadataUrl(),
  ).pathname;

  const payload = {
    resource: resourceUrl,
    scopes_supported: [...MCP_OAUTH_SCOPES],
    bearer_methods_supported: ["header"],
    resource_name: "LedgeIndex MCP (local)",
  };

  fastify.get(protectedResourceMetadataPath, async (_request, reply) => {
    return reply.send(payload);
  });

  fastify.get("/.well-known/oauth-protected-resource", async (_request, reply) => {
    return reply.send(payload);
  });
}
