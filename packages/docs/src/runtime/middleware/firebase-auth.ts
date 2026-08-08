import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import { isKnowledgeIndexApiKey } from "../lib/api-keys.js";
import { logInfo, logWarn } from "../lib/logger.js";
import {
  isApiAuthRequired,
  isFirebaseAdminConfigured,
  verifyFirebaseIdToken,
} from "../lib/firebase-admin.js";
import { validateApiKey } from "../services/api-key-store.js";

function isPublicPath(url: string): boolean {
  const path = url.split("?")[0] ?? url;
  return (
    path === "/health" ||
    path.startsWith("/health/") ||
    path.startsWith("/api/inngest") ||
    // MCP OAuth discovery + token flow (must be public for the Authenticate button)
    path.startsWith("/.well-known/") ||
    path.startsWith("/oauth") ||
    // MCP transport — custom OAuth middleware returns 401 + WWW-Authenticate.
    // Only the transport is public: the rest of /mastra (agents, workflows) exposes
    // system prompts and model invocation and must stay behind auth.
    path.startsWith("/mastra/mcp/") ||
    path === "/mcp" ||
    path.startsWith("/mcp/")
  );
}

function extractBearer(header: string | undefined): string | null {
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  return token || null;
}

function extractApiKey(
  header: string | undefined,
  body: unknown,
): string | null {
  if (header?.startsWith("ApiKey ")) {
    const key = header.slice("ApiKey ".length).trim();
    return key || null;
  }

  const bearer = extractBearer(header);
  if (bearer && isKnowledgeIndexApiKey(bearer)) {
    return bearer;
  }

  if (body && typeof body === "object" && "api_key" in body) {
    const value = (body as { api_key?: unknown }).api_key;
    if (typeof value === "string" && value.length > 0) return value;
  }

  return null;
}

async function authenticateRequest(
  request: {
    headers: { authorization?: string };
    body?: unknown;
  },
): Promise<{
  uid: string;
  email: string | null;
  authMethod: "firebase" | "api_key";
  scopes: string[];
} | null> {
  const authHeader = request.headers.authorization;

  const bearer = extractBearer(authHeader);
  if (bearer && !isKnowledgeIndexApiKey(bearer)) {
    try {
      const decoded = await verifyFirebaseIdToken(bearer);
      return {
        uid: decoded.uid,
        email: decoded.email ?? null,
        authMethod: "firebase",
        scopes: ["*"],
      };
    } catch {
      return null;
    }
  }

  const apiKey = extractApiKey(authHeader, request.body);
  if (!apiKey) return null;

  const keyUser = await validateApiKey(apiKey);
  if (!keyUser) return null;

  return {
    uid: keyUser.userId,
    email: null,
    authMethod: "api_key",
    scopes: keyUser.scopes,
  };
}

const LOCAL_DESKTOP_USER_ID =
  process.env.LEDGEINDEX_LOCAL_USER_ID?.trim() || "automationghost-local";

function localDesktopUser(): {
  uid: string;
  email: string | null;
  authMethod: "firebase" | "api_key";
  scopes: string[];
} {
  return {
    uid: LOCAL_DESKTOP_USER_ID,
    email: null,
    authMethod: "api_key",
    scopes: ["*"],
  };
}

function registerLocalDesktopAuthHook(fastify: FastifyInstance): void {
  fastify.addHook("onRequest", async (request) => {
    if (request.method === "OPTIONS") return;
    if (isPublicPath(request.url)) return;
    if (!isApiAuthRequired()) {
      request.user = localDesktopUser();
    }
  });
}

const firebaseAuthMiddleware: FastifyPluginAsync = async (fastify) => {
  if (!isFirebaseAdminConfigured()) {
    if (isApiAuthRequired()) {
      logWarn(
        "API auth enabled but Firebase Admin credentials missing — requests allowed without verification.",
        "Auth",
      );
    } else {
      logInfo("Firebase Admin not configured — local desktop API user", "Auth", {
        uid: LOCAL_DESKTOP_USER_ID,
      });
      registerLocalDesktopAuthHook(fastify);
    }
    return;
  }

  logInfo("Firebase + API key authentication enabled", "Auth", {
    required: isApiAuthRequired(),
  });

  fastify.addHook("onRequest", async (request, reply) => {
    if (request.method === "OPTIONS") return;
    if (isPublicPath(request.url)) return;

    const authHeader = request.headers.authorization;
    const hasBearer = Boolean(extractBearer(authHeader));

    const user = await authenticateRequest(request);
    if (user) {
      request.user = user;
      return;
    }

    if (!isApiAuthRequired()) {
      request.user = localDesktopUser();
      return;
    }

    if (isApiAuthRequired()) {
      return reply.code(401).send({
        error: hasBearer
          ? "Invalid or expired token"
          : "Authentication required",
      });
    }
  });
};

export default fp(firebaseAuthMiddleware, {
  name: "firebase-auth-middleware",
});
