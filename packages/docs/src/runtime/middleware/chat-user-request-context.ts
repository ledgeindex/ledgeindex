import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import { isKnowledgeIndexApiKey } from "../lib/api-keys.js";

function extractFirebaseBearer(header: string | undefined): string | null {
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  if (!token || isKnowledgeIndexApiKey(token)) return null;
  return token;
}

/**
 * Inject authenticated Fastify user into Mastra chat `requestContext`
 * so MCP-style tools (ask_source, list_platform_sources) see user_id.
 * Also stash the Firebase Bearer as auth_token so desktop tools can proxy
 * global/platform queries to LEDGEINDEX_REMOTE_API_URL.
 */
const chatUserRequestContextPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("preHandler", async (request) => {
    if (request.method !== "POST" || !request.url.startsWith("/chat/")) {
      return;
    }

    const uid = request.user?.uid?.trim();
    const authToken = extractFirebaseBearer(request.headers.authorization);

    if (!uid && !authToken) return;

    const body = request.body;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return;
    }

    const record = body as {
      requestContext?: Record<string, unknown>;
    };
    const existing =
      record.requestContext &&
      typeof record.requestContext === "object" &&
      !Array.isArray(record.requestContext)
        ? record.requestContext
        : {};

    record.requestContext = {
      ...existing,
      ...(uid ? { user_id: uid, userId: uid } : {}),
      ...(authToken ? { auth_token: authToken } : {}),
    };

    const rc = (
      request as { requestContext?: { set?: (k: string, v: unknown) => void } }
    ).requestContext;
    if (rc && typeof rc.set === "function") {
      if (uid) {
        rc.set("user_id", uid);
        rc.set("userId", uid);
      }
      if (authToken) {
        rc.set("auth_token", authToken);
      }
    }
  });
};

export default fp(chatUserRequestContextPlugin, {
  name: "chat-user-request-context-middleware",
});
