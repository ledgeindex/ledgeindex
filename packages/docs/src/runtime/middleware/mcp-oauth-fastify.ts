import type { FastifyPluginAsync, FastifyReply } from "fastify";
import fp from "fastify-plugin";
import { generateWWWAuthenticateHeader } from "@mastra/mcp";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import {
  getMcpResourceUrl,
  getOAuthProtectedResourceMetadataUrl,
  isMcpTransportPath,
} from "../mastra/mcp/config.js";
import { enterMcpAuthContext } from "../mastra/mcp/mcp-auth-context.js";
import { readMcpAccessTokenExp } from "../mastra/mcp/oauth/mcp-access-token.js";
import { resolveMcpBearerUser } from "../mastra/mcp/oauth/resolve-mcp-bearer.js";

type NodeIncomingMessageWithAuth = {
  auth?: AuthInfo;
};

function readBearerToken(authorization: string | undefined): string | null {
  if (!authorization?.startsWith("Bearer ")) return null;
  const token = authorization.slice("Bearer ".length).trim();
  return token || null;
}

function readBearerTokenExpiresAt(token: string): number {
  const mcpExp = readMcpAccessTokenExp(token);
  if (mcpExp != null) return mcpExp;

  try {
    const parts = token.split(".");
    if (parts.length < 2) throw new Error("invalid jwt");
    const payload = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf8"),
    ) as { exp?: unknown };
    if (typeof payload.exp === "number" && Number.isFinite(payload.exp)) {
      return payload.exp;
    }
  } catch {
    // fall through
  }
  return Math.floor(Date.now() / 1000) + 3600;
}

function buildMcpAuthInfo(params: {
  token: string;
  userId: string;
  email?: string;
}): AuthInfo {
  return {
    token: params.token,
    clientId: params.userId,
    scopes: ["mcp:read", "mcp:write"],
    expiresAt: readBearerTokenExpiresAt(params.token),
    resource: new URL(getMcpResourceUrl()),
    extra: {
      userId: params.userId,
      email: params.email,
      access_token: params.token,
    },
  };
}

function sendUnauthorized(reply: FastifyReply, description: string) {
  const resourceMetadataUrl = getOAuthProtectedResourceMetadataUrl();
  return reply
    .code(401)
    .header(
      "WWW-Authenticate",
      generateWWWAuthenticateHeader({ resourceMetadataUrl }),
    )
    .send({ error: "unauthorized", error_description: description });
}

const mcpOAuthFastifyMiddleware: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("onRequest", async (request, reply) => {
    const path = request.url.split("?")[0] ?? request.url;
    if (!isMcpTransportPath(path)) return;
    if (request.method === "OPTIONS") return;

    const token = readBearerToken(request.headers.authorization);
    if (!token) {
      // Initialize / server/discover / tools/list work without a token.
      // Tool execute() still requires a user id.
      return;
    }

    const user = await resolveMcpBearerUser(token);
    if (!user?.id) {
      return sendUnauthorized(reply, "Invalid or expired access token.");
    }

    const authInfo = buildMcpAuthInfo({
      token,
      userId: user.id,
      email: user.email,
    });

    const raw = request.raw as typeof request.raw & NodeIncomingMessageWithAuth;
    raw.auth = authInfo;

    enterMcpAuthContext({
      userId: user.id,
      email: user.email,
      idToken: token,
      authInfo,
    });
  });
};

export default fp(mcpOAuthFastifyMiddleware, {
  name: "mcp-oauth-fastify-middleware",
});
