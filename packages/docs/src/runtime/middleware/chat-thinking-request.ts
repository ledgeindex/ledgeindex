import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import { applyChatThinkingToBody } from "../llm/chat-thinking.js";

/**
 * Ensures Gemini thinking providerOptions are present on Mastra chat routes.
 * Defaults to each model's configured level (e.g. medium for 3.1 Flash Lite)
 * unless the client explicitly sends thinkingLevel: "off".
 */
const chatThinkingRequestPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("preHandler", async (request) => {
    if (request.method !== "POST" || !request.url.startsWith("/chat/")) {
      return;
    }

    const body = request.body;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return;
    }

    request.body = applyChatThinkingToBody(
      body as Parameters<typeof applyChatThinkingToBody>[0],
    );
  });
};

export default fp(chatThinkingRequestPlugin, {
  name: "chat-thinking-request-middleware",
});
