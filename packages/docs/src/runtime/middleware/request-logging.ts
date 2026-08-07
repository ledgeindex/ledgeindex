import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import { RequestLogger } from "../lib/request-logger.js";

type RequestWithStart = {
  startTime?: number;
};

const requestLoggingMiddleware: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("onRequest", async (request) => {
    (request as RequestWithStart).startTime = Date.now();
  });

  fastify.addHook("onResponse", async (request, reply) => {
    const duration = Date.now() - ((request as RequestWithStart).startTime ?? Date.now());

    if (reply.statusCode === 429) {
      RequestLogger.logRateLimited(request, reply, duration);
      return;
    }

    if (reply.statusCode < 400) {
      RequestLogger.logRequest(request, reply, duration);
    }
  });

  fastify.addHook("onError", async (request, reply, error) => {
    if ((error as { statusCode?: number }).statusCode === 429) {
      return;
    }

    const duration = Date.now() - ((request as RequestWithStart).startTime ?? Date.now());
    RequestLogger.logError(request, reply, error, duration);
  });
};

export default fp(requestLoggingMiddleware, {
  name: "request-logging-middleware",
});
