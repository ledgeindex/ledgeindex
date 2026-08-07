import type { FastifyInstance } from "fastify";
import { generateProtectedResourceMetadata } from "@mastra/mcp";
import { getAuth } from "firebase-admin/auth";
import { verifyFirebaseIdToken } from "../lib/firebase-admin.js";
import {
  getFrontendBaseUrl,
  getMastraPublicUrl,
  getMcpResourceUrl,
  getOAuthProtectedResourceMetadataUrl,
  MCP_OAUTH_SCOPES,
  mcpOAuthPath,
  mcpOAuthUrl,
} from "../mastra/mcp/config.js";
import {
  buildOAuthSession,
  consumeAuthCode,
  createAuthCode,
  getOAuthClient,
  getOAuthSession,
  getRefreshRecord,
  isRegisteredRedirectUri,
  registerDynamicClient,
  saveOAuthSession,
  saveRefreshToken,
} from "../mastra/mcp/oauth/oauth-store.js";
import {
  accessTokenTtlSeconds,
  mintMcpAccessToken,
} from "../mastra/mcp/oauth/mcp-access-token.js";
import {
  generateRefreshToken,
  verifyPkceS256,
} from "../mastra/mcp/oauth/pkce.js";

function parseFormBody(body: unknown): Record<string, string> {
  if (body && typeof body === "object" && !Array.isArray(body)) {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
      if (v != null) out[k] = String(v);
    }
    return out;
  }
  return {};
}

async function verifyIdToken(idToken: string) {
  try {
    return await verifyFirebaseIdToken(idToken);
  } catch {
    return null;
  }
}

async function getUserEmail(userId: string): Promise<string | undefined> {
  try {
    const user = await getAuth().getUser(userId);
    return user.email ?? undefined;
  } catch {
    return undefined;
  }
}

function buildOAuthTokenResponse(params: {
  userId: string;
  email?: string;
  scope?: string;
  clientId?: string;
  refreshToken?: string;
}) {
  const accessToken = mintMcpAccessToken({
    sub: params.userId,
    email: params.email,
    scope: params.scope,
    clientId: params.clientId,
  });
  const body: Record<string, unknown> = {
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: accessTokenTtlSeconds(),
    scope: params.scope ?? MCP_OAUTH_SCOPES.join(" "),
  };
  if (params.refreshToken) {
    body.refresh_token = params.refreshToken;
  }
  return body;
}

/**
 * Native Fastify OAuth routes for MCP.
 * Mastra's registerApiRoute + Response.redirect breaks on @mastra/fastify (immutable headers).
 */
export async function mcpOAuthRoutes(fastify: FastifyInstance) {
  // OAuth token exchange (RFC 6749) uses application/x-www-form-urlencoded.
  if (!fastify.hasContentTypeParser("application/x-www-form-urlencoded")) {
    fastify.addContentTypeParser(
      /^application\/x-www-form-urlencoded(?:;|$)/,
      { parseAs: "string" },
      (_request, body, done) => {
        try {
          const raw = typeof body === "string" ? body : String(body);
          const parsed = Object.fromEntries(new URLSearchParams(raw));
          done(null, parsed);
        } catch (error) {
          done(error as Error, undefined);
        }
      },
    );
  }

  const publicUrl = getMastraPublicUrl();
  const resourceUrl = getMcpResourceUrl();
  const protectedResourceMetadataPath = new URL(
    getOAuthProtectedResourceMetadataUrl(),
  ).pathname;

  const oauthConfig = {
    resource: resourceUrl,
    authorizationServers: [publicUrl],
    scopesSupported: [...MCP_OAUTH_SCOPES],
    resourceName: "LedgeIndex MCP",
  };

  const protectedResourcePayload = generateProtectedResourceMetadata(oauthConfig);

  fastify.get(protectedResourceMetadataPath, async (_request, reply) => {
    return reply.send(protectedResourcePayload);
  });

  fastify.get("/.well-known/oauth-protected-resource", async (_request, reply) => {
    return reply.send(protectedResourcePayload);
  });

  fastify.get("/.well-known/oauth-authorization-server", async (_request, reply) => {
    return reply.send({
      issuer: publicUrl,
      authorization_endpoint: mcpOAuthUrl("/authorize"),
      token_endpoint: mcpOAuthUrl("/token"),
      registration_endpoint: mcpOAuthUrl("/register"),
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      scopes_supported: [...MCP_OAUTH_SCOPES],
    });
  });

  fastify.post(mcpOAuthPath("/register"), async (request, reply) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const clientName = String(body.client_name ?? body.clientName ?? "MCP Client").trim();
    const redirectUris = Array.isArray(body.redirect_uris)
      ? body.redirect_uris.map(String)
      : body.redirect_uri
        ? [String(body.redirect_uri)]
        : [];
    if (redirectUris.length < 1) {
      return reply.status(400).send({
        error: "invalid_client_metadata",
        error_description: "redirect_uris required",
      });
    }
    const clientId = await registerDynamicClient(clientName, redirectUris);
    return reply.send({
      client_id: clientId,
      client_name: clientName,
      redirect_uris: redirectUris,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    });
  });

  fastify.get(mcpOAuthPath("/authorize"), async (request, reply) => {
    const url = new URL(request.url, getMastraPublicUrl());
    const responseType = url.searchParams.get("response_type");
    const clientId = url.searchParams.get("client_id") ?? "";
    const redirectUri = url.searchParams.get("redirect_uri") ?? "";
    const state = url.searchParams.get("state") ?? undefined;
    const codeChallenge = url.searchParams.get("code_challenge") ?? "";
    const codeChallengeMethod = url.searchParams.get("code_challenge_method") ?? "S256";
    const scope = url.searchParams.get("scope") ?? undefined;

    if (responseType !== "code" || !clientId || !redirectUri || !codeChallenge) {
      return reply.status(400).send({ error: "invalid_request" });
    }
    if (codeChallengeMethod !== "S256") {
      return reply.status(400).send({
        error: "invalid_request",
        error_description: "Only S256 PKCE supported",
      });
    }

    const client = await getOAuthClient(clientId);
    if (!client) {
      return reply.status(400).send({
        error: "invalid_client",
        error_description: "Unknown client_id",
      });
    }
    if (!(await isRegisteredRedirectUri(clientId, redirectUri))) {
      return reply.status(400).send({
        error: "invalid_request",
        error_description: "Invalid redirect_uri",
      });
    }

    const session = buildOAuthSession({
      clientId,
      redirectUri,
      state,
      codeChallenge,
      codeChallengeMethod,
      scope,
    });
    await saveOAuthSession(session);

    const connectUrl = new URL(`${getFrontendBaseUrl()}/mcp/connect`);
    connectUrl.searchParams.set("oauth_session", session.sessionId);
    return reply.redirect(connectUrl.toString());
  });

  fastify.post(mcpOAuthPath("/consent/approve"), async (request, reply) => {
    const authHeader = request.headers.authorization ?? "";
    const idToken = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7).trim()
      : "";
    if (!idToken) {
      return reply.status(401).send({ error: "unauthorized" });
    }
    const decoded = await verifyIdToken(idToken);
    if (!decoded?.uid) {
      return reply.status(401).send({ error: "invalid_token" });
    }

    const body = (request.body ?? {}) as Record<string, unknown>;
    const sessionId = String(body.oauth_session ?? "").trim();
    if (!sessionId) {
      return reply.status(400).send({
        error: "invalid_request",
        error_description: "oauth_session required",
      });
    }

    const session = await getOAuthSession(sessionId);
    if (!session) {
      return reply.status(400).send({ error: "invalid_session" });
    }

    const code = await createAuthCode({
      session,
      userId: decoded.uid,
      idToken,
    });

    const redirect = new URL(session.redirectUri);
    redirect.searchParams.set("code", code);
    if (session.state) redirect.searchParams.set("state", session.state);

    return reply.send({ redirect_uri: redirect.toString() });
  });

  fastify.post(mcpOAuthPath("/consent/deny"), async (request, reply) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const sessionId = String(body.oauth_session ?? "").trim();
    const session = sessionId ? await getOAuthSession(sessionId) : null;
    if (!session) {
      return reply.status(400).send({ error: "invalid_session" });
    }
    const redirect = new URL(session.redirectUri);
    redirect.searchParams.set("error", "access_denied");
    if (session.state) redirect.searchParams.set("state", session.state);
    return reply.send({ redirect_uri: redirect.toString() });
  });

  fastify.post(mcpOAuthPath("/token"), async (request, reply) => {
    const form = parseFormBody(request.body);

    const grantType = form.grant_type;

    if (grantType === "authorization_code") {
      const code = form.code ?? "";
      const codeVerifier = form.code_verifier ?? "";
      const redirectUri = form.redirect_uri ?? "";
      if (!code || !codeVerifier) {
        return reply.status(400).send({ error: "invalid_request" });
      }

      const authCode = await consumeAuthCode(code);
      if (!authCode) {
        return reply.status(400).send({ error: "invalid_grant" });
      }
      if (redirectUri && redirectUri !== authCode.redirectUri) {
        return reply.status(400).send({
          error: "invalid_grant",
          error_description: "redirect_uri mismatch",
        });
      }
      if (!verifyPkceS256(codeVerifier, authCode.codeChallenge)) {
        return reply.status(400).send({
          error: "invalid_grant",
          error_description: "PKCE verification failed",
        });
      }

      // Consent already verified Firebase; id token may be stale by exchange time.
      const decoded = await verifyIdToken(authCode.idToken).catch(() => null);
      if (decoded?.uid && decoded.uid !== authCode.userId) {
        return reply.status(400).send({
          error: "invalid_grant",
          error_description: "User token invalid",
        });
      }

      const email =
        decoded?.email ?? (await getUserEmail(authCode.userId));

      const refreshToken = generateRefreshToken();
      await saveRefreshToken({
        refreshToken,
        userId: authCode.userId,
        idToken: authCode.idToken,
        clientId: authCode.clientId,
        scope: authCode.scope,
      });

      return reply.send(
        buildOAuthTokenResponse({
          userId: authCode.userId,
          email,
          scope: authCode.scope,
          clientId: authCode.clientId,
          refreshToken,
        }),
      );
    }

    if (grantType === "refresh_token") {
      const refreshToken = form.refresh_token ?? "";
      const record = refreshToken ? await getRefreshRecord(refreshToken) : null;
      if (!record) {
        return reply.status(400).send({ error: "invalid_grant" });
      }
      const email = await getUserEmail(record.userId);
      return reply.send(
        buildOAuthTokenResponse({
          userId: record.userId,
          email,
          scope: record.scope,
          clientId: record.clientId,
        }),
      );
    }

    return reply.status(400).send({ error: "unsupported_grant_type" });
  });

  fastify.get(mcpOAuthPath("/session"), async (request, reply) => {
    const url = new URL(request.url, getMastraPublicUrl());
    const sessionId = url.searchParams.get("oauth_session") ?? "";
    const session = sessionId ? await getOAuthSession(sessionId) : null;
    if (!session) {
      return reply.status(404).send({ ok: false, error: "invalid_session" });
    }
    return reply.send({
      ok: true,
      client_id: session.clientId,
      scope: session.scope ?? MCP_OAUTH_SCOPES.join(" "),
    });
  });
}
