import { registerApiRoute } from "@mastra/core/server";
import { generateProtectedResourceMetadata } from "@mastra/mcp";
import { getAuth } from "firebase-admin/auth";
import { verifyFirebaseIdToken } from "../../../lib/firebase-admin.js";
import {
  getFrontendBaseUrl,
  getMastraPublicUrl,
  getMcpResourceUrl,
  getOAuthProtectedResourceMetadataUrl,
  MCP_OAUTH_SCOPES,
  mcpOAuthPath,
  mcpOAuthUrl,
} from "../config.js";
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
} from "./oauth-store.js";
import { accessTokenTtlSeconds, mintMcpAccessToken } from "./mcp-access-token.js";
import { generateRefreshToken, verifyPkceS256 } from "./pkce.js";

function jsonResponse(
  c: { json: (body: unknown, status?: number) => unknown },
  body: unknown,
  status = 200,
) {
  return c.json(body, status);
}

function redirectResponse(_c: unknown, url: string) {
  return Response.redirect(url, 302);
}

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

export function registerLedgeindexMcpOAuthRoutes() {
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

  const protectedResourceHandler = async (c: {
    json: (body: unknown) => unknown;
  }) => jsonResponse(c, generateProtectedResourceMetadata(oauthConfig));

  return [
    registerApiRoute(protectedResourceMetadataPath, {
      method: "GET",
      requiresAuth: false,
      handler: protectedResourceHandler,
    }),

    registerApiRoute("/.well-known/oauth-protected-resource", {
      method: "GET",
      requiresAuth: false,
      handler: protectedResourceHandler,
    }),

    registerApiRoute("/.well-known/oauth-authorization-server", {
      method: "GET",
      requiresAuth: false,
      handler: async (c) =>
        jsonResponse(c, {
          issuer: publicUrl,
          authorization_endpoint: mcpOAuthUrl("/authorize"),
          token_endpoint: mcpOAuthUrl("/token"),
          registration_endpoint: mcpOAuthUrl("/register"),
          response_types_supported: ["code"],
          grant_types_supported: ["authorization_code", "refresh_token"],
          code_challenge_methods_supported: ["S256"],
          token_endpoint_auth_methods_supported: ["none"],
          scopes_supported: [...MCP_OAUTH_SCOPES],
        }),
    }),

    registerApiRoute(mcpOAuthPath("/register"), {
      method: "POST",
      requiresAuth: false,
      handler: async (c) => {
        const body = await c.req.json().catch(() => ({}));
        const clientName = String(
          body.client_name ?? body.clientName ?? "MCP Client",
        ).trim();
        const redirectUris = Array.isArray(body.redirect_uris)
          ? body.redirect_uris.map(String)
          : body.redirect_uri
            ? [String(body.redirect_uri)]
            : [];
        if (redirectUris.length < 1) {
          return jsonResponse(
            c,
            {
              error: "invalid_client_metadata",
              error_description: "redirect_uris required",
            },
            400,
          );
        }
        const clientId = await registerDynamicClient(clientName, redirectUris);
        return jsonResponse(c, {
          client_id: clientId,
          client_name: clientName,
          redirect_uris: redirectUris,
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
          token_endpoint_auth_method: "none",
        });
      },
    }),

    registerApiRoute(mcpOAuthPath("/authorize"), {
      method: "GET",
      requiresAuth: false,
      handler: async (c) => {
        const url = new URL(c.req.url, getMastraPublicUrl());
        const responseType = url.searchParams.get("response_type");
        const clientId = url.searchParams.get("client_id") ?? "";
        const redirectUri = url.searchParams.get("redirect_uri") ?? "";
        const state = url.searchParams.get("state") ?? undefined;
        const codeChallenge = url.searchParams.get("code_challenge") ?? "";
        const codeChallengeMethod =
          url.searchParams.get("code_challenge_method") ?? "S256";
        const scope = url.searchParams.get("scope") ?? undefined;

        if (
          responseType !== "code" ||
          !clientId ||
          !redirectUri ||
          !codeChallenge
        ) {
          return jsonResponse(c, { error: "invalid_request" }, 400);
        }
        if (codeChallengeMethod !== "S256") {
          return jsonResponse(
            c,
            {
              error: "invalid_request",
              error_description: "Only S256 PKCE supported",
            },
            400,
          );
        }

        const client = await getOAuthClient(clientId);
        if (!client) {
          return jsonResponse(
            c,
            { error: "invalid_client", error_description: "Unknown client_id" },
            400,
          );
        }
        if (!(await isRegisteredRedirectUri(clientId, redirectUri))) {
          return jsonResponse(
            c,
            {
              error: "invalid_request",
              error_description: "Invalid redirect_uri",
            },
            400,
          );
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
        return redirectResponse(c, connectUrl.toString());
      },
    }),

    registerApiRoute(mcpOAuthPath("/consent/approve"), {
      method: "POST",
      requiresAuth: false,
      handler: async (c) => {
        const authHeader = c.req.header("authorization") ?? "";
        const idToken = authHeader.startsWith("Bearer ")
          ? authHeader.slice(7).trim()
          : "";
        if (!idToken) {
          return jsonResponse(c, { error: "unauthorized" }, 401);
        }
        const decoded = await verifyIdToken(idToken);
        if (!decoded?.uid) {
          return jsonResponse(c, { error: "invalid_token" }, 401);
        }

        const body = await c.req.json().catch(() => ({}));
        const sessionId = String(body.oauth_session ?? "").trim();
        if (!sessionId) {
          return jsonResponse(
            c,
            {
              error: "invalid_request",
              error_description: "oauth_session required",
            },
            400,
          );
        }

        const session = await getOAuthSession(sessionId);
        if (!session) {
          return jsonResponse(c, { error: "invalid_session" }, 400);
        }

        const code = await createAuthCode({
          session,
          userId: decoded.uid,
          idToken,
        });

        const redirect = new URL(session.redirectUri);
        redirect.searchParams.set("code", code);
        if (session.state) redirect.searchParams.set("state", session.state);

        return jsonResponse(c, { redirect_uri: redirect.toString() });
      },
    }),

    registerApiRoute(mcpOAuthPath("/consent/deny"), {
      method: "POST",
      requiresAuth: false,
      handler: async (c) => {
        const body = await c.req.json().catch(() => ({}));
        const sessionId = String(body.oauth_session ?? "").trim();
        const session = sessionId ? await getOAuthSession(sessionId) : null;
        if (!session) {
          return jsonResponse(c, { error: "invalid_session" }, 400);
        }
        const redirect = new URL(session.redirectUri);
        redirect.searchParams.set("error", "access_denied");
        if (session.state) redirect.searchParams.set("state", session.state);
        return jsonResponse(c, { redirect_uri: redirect.toString() });
      },
    }),

    registerApiRoute(mcpOAuthPath("/token"), {
      method: "POST",
      requiresAuth: false,
      handler: async (c) => {
        const contentType = c.req.header("content-type") ?? "";
        let form: Record<string, string> = {};
        if (contentType.includes("application/json")) {
          form = parseFormBody(await c.req.json().catch(() => ({})));
        } else {
          const raw = await c.req.text().catch(() => "");
          form = Object.fromEntries(new URLSearchParams(raw));
        }

        const grantType = form.grant_type;

        if (grantType === "authorization_code") {
          const code = form.code ?? "";
          const codeVerifier = form.code_verifier ?? "";
          const redirectUri = form.redirect_uri ?? "";
          if (!code || !codeVerifier) {
            return jsonResponse(c, { error: "invalid_request" }, 400);
          }

          const authCode = await consumeAuthCode(code);
          if (!authCode) {
            return jsonResponse(c, { error: "invalid_grant" }, 400);
          }
          if (redirectUri && redirectUri !== authCode.redirectUri) {
            return jsonResponse(
              c,
              {
                error: "invalid_grant",
                error_description: "redirect_uri mismatch",
              },
              400,
            );
          }
          if (!verifyPkceS256(codeVerifier, authCode.codeChallenge)) {
            return jsonResponse(
              c,
              {
                error: "invalid_grant",
                error_description: "PKCE verification failed",
              },
              400,
            );
          }

          const decoded = await verifyIdToken(authCode.idToken);
          if (!decoded?.uid || decoded.uid !== authCode.userId) {
            return jsonResponse(
              c,
              {
                error: "invalid_grant",
                error_description: "User token invalid",
              },
              400,
            );
          }

          const refreshToken = generateRefreshToken();
          await saveRefreshToken({
            refreshToken,
            userId: authCode.userId,
            idToken: authCode.idToken,
            clientId: authCode.clientId,
            scope: authCode.scope,
          });

          return jsonResponse(
            c,
            buildOAuthTokenResponse({
              userId: authCode.userId,
              email: decoded.email,
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
            return jsonResponse(c, { error: "invalid_grant" }, 400);
          }
          const email = await getUserEmail(record.userId);
          return jsonResponse(
            c,
            buildOAuthTokenResponse({
              userId: record.userId,
              email,
              scope: record.scope,
              clientId: record.clientId,
            }),
          );
        }

        return jsonResponse(c, { error: "unsupported_grant_type" }, 400);
      },
    }),

    registerApiRoute(mcpOAuthPath("/session"), {
      method: "GET",
      requiresAuth: false,
      handler: async (c) => {
        const url = new URL(c.req.url);
        const sessionId = url.searchParams.get("oauth_session") ?? "";
        const session = sessionId ? await getOAuthSession(sessionId) : null;
        if (!session) {
          return jsonResponse(c, { ok: false, error: "invalid_session" }, 404);
        }
        return jsonResponse(c, {
          ok: true,
          client_id: session.clientId,
          scope: session.scope ?? MCP_OAUTH_SCOPES.join(" "),
        });
      },
    }),
  ];
}
