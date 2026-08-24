import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import {
  DailyMessageLimitError,
  routeCountsAsDailyMessage,
  takeDailyMessage,
} from "../services/daily-message-limit.js";

const dailyMessageLimitMiddleware: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("preHandler", async (request, reply) => {
    if (!routeCountsAsDailyMessage(request.method, request.url)) return;

    const userId = request.user?.uid?.trim();
    if (!userId) return;

    try {
      await takeDailyMessage(userId);
    } catch (error) {
      if (error instanceof DailyMessageLimitError) {
        return reply.status(429).send({
          error: error.message,
          code: error.code,
          limit: error.limit,
          used: error.used,
          resetsAt: error.resetsAt,
        });
      }
      throw error;
    }
  });
};

export default fp(dailyMessageLimitMiddleware, {
  name: "daily-message-limit-middleware",
});
