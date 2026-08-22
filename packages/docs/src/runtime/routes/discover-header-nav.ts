import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { normalizeStartUrl } from "../lib/url.js";
import {
  discoverHeaderNavPaths,
  listHeaderNavProviders,
} from "../crawler/discover-header-nav.js";

const bodySchema = z.object({
  url: z.string().min(1),
  provider: z.enum(["google", "openai", "deepseek"]).optional(),
});

export async function discoverHeaderNavRoutes(fastify: FastifyInstance) {
  fastify.get("/api/discover-header-nav", async () => {
    return listHeaderNavProviders();
  });

  fastify.post("/api/discover-header-nav", async (request, reply) => {
    const { url: rawUrl, provider } = bodySchema.parse(request.body);
    const url = normalizeStartUrl(rawUrl);

    try {
      new URL(url);
    } catch {
      return reply.status(400).send({ error: "Invalid URL" });
    }

    try {
      const result = await discoverHeaderNavPaths(url, provider);
      return result;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Header nav discovery failed";
      const status =
        /not installed|api key missing|needs a .+ key/i.test(message)
          ? 501
          : 502;
      return reply.status(status).send({ error: message });
    }
  });
}
