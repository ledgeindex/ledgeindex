import type { FastifyInstance } from "fastify";
import { getDailyMessageUsage } from "../services/daily-message-limit.js";
import { requireUser } from "../lib/resource-access.js";

export async function usageRoutes(fastify: FastifyInstance) {
  /** Hosted cloud chat/ask budget for the signed-in user (UTC day). */
  fastify.get("/api/usage/cloud-messages", async (request, reply) => {
    const userId = await requireUser(request, reply);
    if (!userId) return;

    const usage = await getDailyMessageUsage(userId);
    return { cloudOnly: true, ...usage };
  });
}
