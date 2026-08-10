import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { preflightStartUrl } from "../crawler/preflight.js";
import { normalizeStartUrl } from "../lib/url.js";

const bodySchema = z.object({
  url: z.string().min(1),
  sitemapUrls: z.array(z.string().url()).optional(),
});

export async function preflightRoutes(fastify: FastifyInstance) {
  fastify.post("/api/preflight", async (request, reply) => {
    const { url: rawUrl, sitemapUrls } = bodySchema.parse(request.body);
    const url = normalizeStartUrl(rawUrl);

    try {
      new URL(url);
    } catch {
      return reply.status(400).send({ error: "Invalid URL" });
    }

    try {
      const result = await preflightStartUrl(url, undefined, sitemapUrls ?? []);
      return { preflight: result };
    } catch (error) {
      if (error instanceof Error && error.name === "UnsupportedStartUrlError") {
        return reply.status(400).send({ error: error.message });
      }
      const message =
        error instanceof Error ? error.message : "Preflight check failed";
      return reply.status(502).send({ error: message });
    }
  });
}
