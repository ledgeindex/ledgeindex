import { generateWWWAuthenticateHeader } from "@mastra/mcp";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { isApiAuthRequired } from "../../../lib/firebase-admin.js";
import {
  getMcpResourceUrl,
  getOAuthProtectedResourceMetadataUrl,
  isMcpTransportPath,
} from "../config.js";
import { getMcpAuthContext, runWithMcpAuth } from "../mcp-auth-context.js";
import { readMcpAccessTokenExp } from "./mcp-access-token.js";
import { resolveMcpBearerUser } from "./resolve-mcp-bearer.js";

const LOCAL_DESKTOP_USER_ID =
  process.env.LEDGEINDEX_LOCAL_USER_ID?.trim() || "ledgeindex-desktop-local";

function getRequestPath(context: {
  req?: { path?: string; raw?: { url?: string }; url?: string };
}): string {
  try {
    const path = context.req?.path;
    if (typeof path === "string" && path) return path;
    const rawUrl = String(context.req?.raw?.url ?? context.req?.url ?? "");
    return new URL(rawUrl, "http://localhost").pathname;
  } catch {
    return "";
  }
}

function isMcpTransportPathForMiddleware(path: string): boolean {
  return isMcpTransportPath(path);
}

function unauthorizedResponse(
  context: {
    json: (
      body: unknown,
      status: number,
      headers?: Record<string, string>,
    ) => unknown;
  },
  description: string,
) {
  const resourceMetadataUrl = getOAuthProtectedResourceMetadataUrl();
  return context.json(
    { error: "unauthorized", error_description: description },
    401,
    { "WWW-Authenticate": generateWWWAuthenticateHeader({ resourceMetadataUrl }) },
  );
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

type NodeIncomingMessageWithAuth = {
  auth?: AuthInfo;
};

function readBearerToken(context: {
  req?: {
    header?: (name: string) => string | undefined;
    raw?: { headers?: { get?: (name: string) => string | null } };
  };
}): string | undefined {
  const authHeader =
    context.req?.header?.("Authorization") ??
    context.req?.header?.("authorization") ??
    context.req?.raw?.headers?.get?.("authorization") ??
    undefined;
  if (typeof authHeader !== "string" || !authHeader.startsWith("Bearer ")) {
    return undefined;
  }
  const token = authHeader.slice("Bearer ".length).trim();
  return token || undefined;
}

export async function mcpOAuthDiscoveryMiddleware(
  context: {
    req?: {
      path?: string;
      raw?: { url?: string; headers?: { get?: (name: string) => string | null } };
      url?: string;
      header?: (name: string) => string | undefined;
    };
    get?: (key: string) => unknown;
    set?: (key: string, value: unknown) => void;
    json: (
      body: unknown,
      status: number,
      headers?: Record<string, string>,
    ) => unknown;
    res?: {
      status?: number;
      headers?: {
        get?: (name: string) => string | null;
        set?: (name: string, value: string) => void;
      };
    };
  },
  next: () => Promise<void>,
) {
  const path = getRequestPath(context);
  if (!isMcpTransportPathForMiddleware(path)) {
    await next();
    return;
  }

  const token = readBearerToken(context);

  // Desktop / local sidecar (AUTH_REQUIRED≠1): allow MCP without OAuth and
  // bind tools to LEDGEINDEX_LOCAL_USER_ID so personal sources resolve.
  if (!isApiAuthRequired()) {
    let userId = LOCAL_DESKTOP_USER_ID;
    let email = "";
    let idToken = token ?? "local-desktop";

    if (token) {
      const resolved = await resolveMcpBearerUser(token);
      if (resolved?.id) {
        userId = resolved.id;
        email = resolved.email;
        idToken = token;
      }
    }

    const authInfo = buildMcpAuthInfo({
      token: idToken,
      userId,
      email,
    });
    const raw = context.req?.raw as NodeIncomingMessageWithAuth | undefined;
    if (raw) raw.auth = authInfo;

    await runWithMcpAuth(
      { userId, email, idToken, authInfo },
      async () => {
        const requestContext = context.get?.("requestContext") as
          | { set?: (key: string, value: unknown) => void }
          | undefined;
        requestContext?.set?.("user_id", userId);
        requestContext?.set?.("userId", userId);
        requestContext?.set?.("user", { id: userId, email });
        requestContext?.set?.("auth_token", idToken);
        requestContext?.set?.("authInfo", authInfo);
        await next();
      },
    );
    return;
  }

  if (!token) {
    unauthorizedResponse(context, "Authentication required.");
    return;
  }

  const user = await resolveMcpBearerUser(token);
  if (!user?.id) {
    unauthorizedResponse(context, "Invalid or expired access token.");
    return;
  }

  const authInfo = buildMcpAuthInfo({
    token,
    userId: user.id,
    email: user.email,
  });

  const raw = context.req?.raw as NodeIncomingMessageWithAuth | undefined;
  if (raw) raw.auth = authInfo;

  await runWithMcpAuth(
    { userId: user.id, email: user.email, idToken: token, authInfo },
    async () => {
      const requestContext = context.get?.("requestContext") as
        | { set?: (key: string, value: unknown) => void }
        | undefined;
      requestContext?.set?.("user_id", user.id);
      requestContext?.set?.("userId", user.id);
      requestContext?.set?.("user", { id: user.id, email: user.email });
      requestContext?.set?.("auth_token", token);
      requestContext?.set?.("authInfo", authInfo);

      await next();

      if (
        context.res?.status === 401 &&
        !context.res.headers?.get?.("WWW-Authenticate")
      ) {
        context.res.headers?.set?.(
          "WWW-Authenticate",
          generateWWWAuthenticateHeader({
            resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(),
          }),
        );
      }
    },
  );
}
