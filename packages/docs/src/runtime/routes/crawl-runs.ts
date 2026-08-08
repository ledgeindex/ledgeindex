import type { FastifyInstance } from "fastify";
import { getStore } from "../db/index.js";
import { getSourceForUser, requireUser } from "../lib/resource-access.js";

export async function crawlRunRoutes(fastify: FastifyInstance) {
  fastify.get("/api/crawl-runs/:id", async (request, reply) => {
    const userId = await requireUser(request, reply);
    if (!userId) return;

    const { id } = request.params as { id: string };
    const crawlRun = await getStore().getCrawlRun(id);
    if (!crawlRun) {
      return reply.status(404).send({ error: "Crawl run not found" });
    }

    const source = await getSourceForUser(crawlRun.sourceId, userId);
    if (!source) {
      return reply.status(404).send({ error: "Crawl run not found" });
    }

    return { crawlRun };
  });
}
