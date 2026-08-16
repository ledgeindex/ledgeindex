import type { FastifyInstance } from "fastify";
import { getBillingConfig } from "../services/billing-config.js";
import { isPlanLimitsEnabled } from "../services/source-set-limits.js";
import { getUserPlan } from "../services/user-plan.js";
import { requireUser } from "../lib/resource-access.js";

export async function billingRoutes(fastify: FastifyInstance) {
  fastify.get("/api/billing/config", async (request, reply) => {
    const userId = await requireUser(request, reply);
    if (!userId) return;

    if (!isPlanLimitsEnabled()) {
      return reply.status(404).send({ error: "Billing is not enabled" });
    }

    const plan = await getUserPlan(userId);
    return getBillingConfig(plan);
  });
}
