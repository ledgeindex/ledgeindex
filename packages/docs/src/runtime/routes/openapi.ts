import type { FastifyInstance } from "fastify";
import {
  buildPublicOpenApiSpec,
  defaultPublicApiSpecUrls,
} from "../openapi/public-api-spec.js";

export async function openApiRoutes(fastify: FastifyInstance) {
  fastify.get("/openapi.json", async (_request, reply) => {
    const spec = buildPublicOpenApiSpec(defaultPublicApiSpecUrls());
    reply.header("Cache-Control", "public, max-age=3600");
    reply.header("Vary", "Accept, Accept-Encoding");
    return spec;
  });
}
