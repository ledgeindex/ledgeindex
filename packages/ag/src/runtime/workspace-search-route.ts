import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { kapaRetrieve } from "@ledgeindex/docs/runtime/retrieval/kapa-retrieve.js";
import { listSourceSummariesForOwner } from "@ledgeindex/docs/runtime/services/source-summary.js";
import {
  AG_BRAIN_LEDGEINDEX_SOURCE_SLUG,
  relativePathFromBrainPageUrl,
} from "../brain-source.js";
import { LOCAL_DESKTOP_USER_ID } from "../lib/local-desktop-user.js";

const searchBodySchema = z.object({
  query: z.string().min(2),
  topK: z.number().int().min(1).max(20).optional().default(8),
});

async function resolveBrainSourceId(): Promise<string | null> {
  const sources = await listSourceSummariesForOwner(LOCAL_DESKTOP_USER_ID);
  const match = sources.find((s) => s.slug === AG_BRAIN_LEDGEINDEX_SOURCE_SLUG);
  return match?.id ?? null;
}

export async function registerAgWorkspaceSearchRoutes(
  fastify: FastifyInstance,
): Promise<void> {
  fastify.post("/api/ag/workspace/search", async (request, reply) => {
    const body = searchBodySchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({
        ok: false,
        query: "",
        results: [],
        error: body.error.flatten(),
      });
    }

    const query = body.data.query.trim();
    const topK = body.data.topK ?? 8;

    const sourceId = await resolveBrainSourceId();
    if (!sourceId) {
      return {
        ok: true,
        query,
        results: [],
        backend: "ledgeindex",
        reason: "brain_source_missing",
      };
    }

    try {
      const retrieval = await kapaRetrieve({
        query,
        sourceId,
      });

      const results = retrieval.pruned.slice(0, topK).map((chunk) => {
        const fromUrl = relativePathFromBrainPageUrl(chunk.url);
        const filePath = fromUrl ?? chunk.url;
        return {
          filePath,
          label: chunk.title || filePath,
          chunkIndex: chunk.chunkIndex,
          text: chunk.text,
          score: chunk.score,
        };
      });

      return { ok: true, query, results, backend: "ledgeindex" };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Search failed";
      return reply.status(500).send({
        ok: false,
        query,
        results: [],
        error: message,
      });
    }
  });
}
