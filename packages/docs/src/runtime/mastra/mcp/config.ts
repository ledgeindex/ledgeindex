export const LEDGEINDEX_MCP_SERVER_ID = "ledgeindex-mcp";

/** MastraServer route prefix in @mastra/fastify. */
export const MASTRA_API_PREFIX = "/mastra";

/**
 * Public MCP HTTP path for clients (Cursor mcp.json, OAuth resource).
 * Served by a dedicated Fastify route — not Mastra's nested mount path.
 */
export const MCP_PUBLIC_HTTP_PATH = "/mcp";

export const MCP_OAUTH_BASE_PATH = "/oauth";

export function mcpOAuthPath(suffix: string): string {
  const normalized = suffix.startsWith("/") ? suffix : `/${suffix}`;
  return `${MCP_OAUTH_BASE_PATH}${normalized}`;
}

export function mcpOAuthUrl(suffix: string): string {
  return `${getMastraPublicUrl()}${mcpOAuthPath(suffix)}`;
}

export function getMastraPublicUrl(): string {
  const raw = process.env.MASTRA_PUBLIC_URL?.trim();
  if (raw) return raw.replace(/\/$/, "");
  const port = process.env.PORT ?? "3010";
  // Mastra MCP + OAuth routes mount at server root (not under /mastra prefix).
  return `http://localhost:${port}`;
}

export function getFrontendBaseUrl(): string {
  const raw =
    process.env.LEDGEINDEX_FRONTEND_URL?.trim() ??
    process.env.FRONTEND_BASE_URL?.trim();
  if (raw) return raw.replace(/\/$/, "");
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "LEDGEINDEX_FRONTEND_URL is required in production (MCP OAuth redirect).",
    );
  }
  return "http://localhost:3004";
}

/** Internal Mastra mount: /mastra/mcp/{serverId}/ (Studio / list APIs). */
export function getMcpTransportPathPrefix(): string {
  return `${MASTRA_API_PREFIX}/mcp/${LEDGEINDEX_MCP_SERVER_ID}/`;
}

/** Nested Mastra streamable HTTP path (internal). Prefer {@link getMcpHttpPath}. */
export function getMcpInternalHttpPath(): string {
  return `${getMcpTransportPathPrefix()}mcp`;
}

/** Public path for clients — keep this short (`/mcp`). */
export function getMcpHttpPath(): string {
  return MCP_PUBLIC_HTTP_PATH;
}

export function getMcpResourceUrl(): string {
  return `${getMastraPublicUrl()}${getMcpHttpPath()}`;
}

export function isMcpPublicTransportPath(path: string): boolean {
  const normalized = path.split("?")[0] ?? path;
  return (
    normalized === MCP_PUBLIC_HTTP_PATH ||
    normalized === `${MCP_PUBLIC_HTTP_PATH}/sse` ||
    normalized === `${MCP_PUBLIC_HTTP_PATH}/messages`
  );
}

export function isMcpTransportPath(path: string): boolean {
  const normalized = path.split("?")[0] ?? path;
  if (isMcpPublicTransportPath(normalized)) return true;
  if (!normalized.startsWith(getMcpTransportPathPrefix())) return false;
  return (
    normalized.endsWith("/mcp") ||
    normalized.endsWith("/sse") ||
    normalized.endsWith("/messages")
  );
}

export function getOAuthProtectedResourceMetadataUrl(): string {
  const resource = new URL(getMcpResourceUrl());
  const rsPath =
    resource.pathname && resource.pathname !== "/" ? resource.pathname : "";
  return new URL(
    `/.well-known/oauth-protected-resource${rsPath}`,
    resource.origin,
  ).href;
}

export const MCP_OAUTH_SCOPES = ["mcp:read", "mcp:write"] as const;
