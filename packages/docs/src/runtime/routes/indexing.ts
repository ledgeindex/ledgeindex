import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { indexPagesForSource } from "../indexing/index-chunks.js";
import {
  buildIndexSizeEstimate,
  estimateChunkCountFromMarkdown,
} from "../indexing/index-size-estimate.js";
import {
  clearIngestCancellation,
  IngestCancelledError,
} from "../ingest/ingest-cancel.js";
import { parsePage } from "../parser/extract-content.js";
import { ensureCatalogHasPages } from "../retrieval/page-catalog-rebuild.js";
import { getExampleCatalog } from "../retrieval/example-catalog-store.js";
import { getPageChunks } from "../retrieval/page-chunks.js";
import { getPageExamples } from "../retrieval/page-examples.js";
import { kapaRetrieve } from "../retrieval/kapa-retrieve.js";
import { getVectorBackend } from "../vector/config.js";
import { runWithRetrievalContext } from "../retrieval/rerank-request-context.js";
import { logError, logInfo } from "../lib/logger.js";
import { dedupeUrlsByCanonical } from "../crawler/canonical-dedupe.js";
import {
  getRequestUserRole,
  getSourceForUser,
  getSourceForWrite,
  requireUser,
} from "../lib/resource-access.js";
import { indexRepoCheckout } from "@ledgeindex/repo";
import { markSourceAsRepository } from "../services/source-kind.js";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const indexPreviewBodySchema = z.object({
  pages: z
    .array(
      z.object({
        url: z.string().url(),
        title: z.string().min(1),
        markdown: z.string(),
        language: z.string().optional(),
        contentType: z.string().optional(),
        chunkStrategy: z.enum(["semantic-markdown", "recursive"]).optional(),
        chunkLanguage: z.string().nullable().optional(),
      }),
    )
    .min(1)
    .max(500),
});

const indexRepoBodySchema = z
  .object({
    /** Absolute path to a local git checkout readable by this server. */
    checkoutPath: z.string().min(1).optional(),
    /** Repository URL. Cloned into the checkout cache when no path is given. */
    githubUrl: z.string().optional(),
    /** Branch, tag, or commit to clone. */
    ref: z.string().min(1).optional(),
    maxFiles: z.number().int().positive().max(5000).optional(),
    /** Opt back into test/eval/fixture files, which are excluded by default. */
    includeTests: z.boolean().optional(),
    /** Opt back into .md / .mdx (README, etc.), which are excluded by default. */
    includeReadme: z.boolean().optional(),
    /**
     * Optional extension allowlist (e.g. `[".ts", ".tsx"]` or `["ts","tsx"]`).
     * Narrows the default JS/TS set; unknown extensions are rejected.
     */
    extensions: z.array(z.string().min(1)).max(20).optional(),
  })
  .refine((body) => Boolean(body.checkoutPath || body.githubUrl), {
    message: "Provide checkoutPath or githubUrl",
  });

const queryBodySchema = z.object({
  query: z.string().min(1),
  filter: z
    .object({
      category: z.string().optional(),
      section: z.string().optional(),
    })
    .optional(),
});

const INDEX_ESTIMATE_MAX_URLS = 120;
const INDEX_ESTIMATE_CONCURRENCY = 6;

const indexEstimateBodySchema = z.object({
  urls: z.array(z.string().url()).min(1).max(INDEX_ESTIMATE_MAX_URLS),
  selectedUrlCount: z.number().int().positive().optional(),
  contentSelectors: z.array(z.string()).optional(),
  excludeSelectors: z.array(z.string()).optional(),
});

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function runWorker() {
    while (nextIndex < items.length) {
      const current = nextIndex++;
      results[current] = await worker(items[current]!, current);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => runWorker()),
  );

  return results;
}

export async function indexingRoutes(fastify: FastifyInstance) {
  fastify.get("/api/sources/:id/metadata-catalog", async (request, reply) => {
    const userId = await requireUser(request, reply);
    if (!userId) return;

    const { id } = request.params as { id: string };
    const source = await getSourceForUser(id, userId);
    if (!source) {
      return reply.status(404).send({ error: "Source not found" });
    }

    const catalog = await ensureCatalogHasPages(id);
    return {
      sourceId: id,
      catalog,
      vectorBackend: getVectorBackend(),
    };
  });

  fastify.get("/api/sources/:id/example-catalog", async (request, reply) => {
    const userId = await requireUser(request, reply);
    if (!userId) return;

    const { id } = request.params as { id: string };
    const source = await getSourceForUser(id, userId);
    if (!source) {
      return reply.status(404).send({ error: "Source not found" });
    }

    const catalog = await getExampleCatalog(id);
    return {
      sourceId: id,
      catalog,
      exampleCount: catalog?.examples.length ?? 0,
    };
  });

  /** Indexed chunk text for one page — debug / MD preview (same store as retrieval expansion). */
  fastify.get("/api/sources/:id/page-chunks", async (request, reply) => {
    const userId = await requireUser(request, reply);
    if (!userId) return;

    const { id } = request.params as { id: string };
    const source = await getSourceForUser(id, userId);
    if (!source) {
      return reply.status(404).send({ error: "Source not found" });
    }

    const query = request.query as { url?: string };
    const url = typeof query.url === "string" ? query.url.trim() : "";
    if (!url) {
      return reply.status(400).send({ error: "url query param is required" });
    }

    try {
      const result = await getPageChunks({ sourceId: id, url });
      return {
        vectorBackend: getVectorBackend(),
        ...result,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to load page chunks";
      logError(error instanceof Error ? error : message, "PageChunks", {
        sourceId: id,
        url,
      });
      return reply.status(500).send({ error: message });
    }
  });

  /** Indexed examples for one page — preview next to MD / chunks. */
  fastify.get("/api/sources/:id/page-examples", async (request, reply) => {
    const userId = await requireUser(request, reply);
    if (!userId) return;

    const { id } = request.params as { id: string };
    const source = await getSourceForUser(id, userId);
    if (!source) {
      return reply.status(404).send({ error: "Source not found" });
    }

    const query = request.query as { url?: string };
    const url = typeof query.url === "string" ? query.url.trim() : "";
    if (!url) {
      return reply.status(400).send({ error: "url query param is required" });
    }

    try {
      const result = await getPageExamples({ sourceId: id, url });
      return {
        vectorBackend: getVectorBackend(),
        ...result,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to load page examples";
      logError(error instanceof Error ? error : message, "PageExamples", {
        sourceId: id,
        url,
      });
      return reply.status(500).send({ error: message });
    }
  });

  fastify.post("/api/sources/:id/index-preview", async (request, reply) => {
    const userId = await requireUser(request, reply);
    if (!userId) return;

    const role = await getRequestUserRole(request);
    const { id } = request.params as { id: string };
    const source = await getSourceForWrite(id, userId, role);
    if (!source) {
      return reply.status(404).send({ error: "Source not found" });
    }

    const body = indexPreviewBodySchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: body.error.flatten() });
    }

    try {
      const sourceScope = source.scope === "global" ? "global" : "personal";
      const sourceHosting =
        source.hosting === "cloud" || source.scope === "global"
          ? "cloud"
          : "local";

      const result = await runWithRetrievalContext(
        {
          sourceScope,
          sourceHosting,
          backend: sourceHosting === "cloud" ? "cohere-auto" : undefined,
        },
        async () => {
          logInfo("Index preview started", "IndexPreview", {
            sourceId: id,
            pageCount: body.data.pages.length,
            vectorBackend: getVectorBackend(),
            hosting: sourceHosting,
          });

          clearIngestCancellation(id);

          return indexPagesForSource({
            sourceId: id,
            projectId: source.projectId,
            pages: body.data.pages,
          });
        },
      );

      return {
        indexed: true,
        vectorBackend: getVectorBackend(),
        ...result,
      };
    } catch (error) {
      if (error instanceof IngestCancelledError) {
        return reply.status(499).send({ error: "Indexing cancelled" });
      }
      const message =
        error instanceof Error ? error.message : "Index preview failed";
      logError(error instanceof Error ? error : message, "IndexPreview", {
        sourceId: id,
      });
      return reply.status(500).send({ error: message });
    }
  });

  fastify.post("/api/sources/:id/index-repo", async (request, reply) => {
    const userId = await requireUser(request, reply);
    if (!userId) return;

    const role = await getRequestUserRole(request);
    const { id } = request.params as { id: string };
    const source = await getSourceForWrite(id, userId, role);
    if (!source) {
      return reply.status(404).send({ error: "Source not found" });
    }

    const body = indexRepoBodySchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: body.error.flatten() });
    }

    // No path means clone from the URL; a path must already exist on this host.
    const checkoutPath = body.data.checkoutPath
      ? resolve(body.data.checkoutPath)
      : undefined;
    if (checkoutPath && !existsSync(checkoutPath)) {
      return reply
        .status(400)
        .send({ error: `Checkout path not found: ${checkoutPath}` });
    }

    try {
      logInfo("Repo index started", "IndexRepo", {
        sourceId: id,
        checkoutPath: checkoutPath ?? "(clone)",
        githubUrl: body.data.githubUrl ?? null,
        vectorBackend: getVectorBackend(),
      });

      clearIngestCancellation(id);

      const result = await indexRepoCheckout({
        sourceId: id,
        projectId: source.projectId,
        checkoutPath,
        githubUrl: body.data.githubUrl ?? null,
        ref: body.data.ref ?? null,
        sourceSlug: source.slug,
        maxFiles: body.data.maxFiles,
        includeTests: body.data.includeTests,
        includeReadme: body.data.includeReadme,
        extensions: body.data.extensions,
      });

      await markSourceAsRepository(id);

      return {
        indexed: true,
        vectorBackend: getVectorBackend(),
        ...result,
      };
    } catch (error) {
      if (error instanceof IngestCancelledError) {
        return reply.status(499).send({ error: "Indexing cancelled" });
      }
      const message =
        error instanceof Error ? error.message : "Repo index failed";
      logError(error instanceof Error ? error : message, "IndexRepo", {
        sourceId: id,
      });
      return reply.status(500).send({ error: message });
    }
  });

  fastify.post("/api/sources/:id/index-estimate", async (request, reply) => {
    const userId = await requireUser(request, reply);
    if (!userId) return;

    const role = await getRequestUserRole(request);
    const { id } = request.params as { id: string };
    const source = await getSourceForWrite(id, userId, role);
    if (!source) {
      return reply.status(404).send({ error: "Source not found" });
    }

    const body = indexEstimateBodySchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: body.error.flatten() });
    }

    const contentSelectors =
      body.data.contentSelectors ?? source.config.contentSelectors;
    const excludeSelectors =
      body.data.excludeSelectors ?? source.config.excludeSelectors;

    logInfo("Index size estimate started", "IndexEstimate", {
      sourceId: id,
      urlCount: body.data.urls.length,
    });

    const { unique: urlsToEstimate, skipped: dedupeSkipped } =
      dedupeUrlsByCanonical(body.data.urls);

    if (dedupeSkipped.length > 0) {
      logInfo("Index size estimate: canonical duplicates skipped", "IndexEstimate", {
        sourceId: id,
        selectedUrlCount: body.data.urls.length,
        uniqueUrlCount: urlsToEstimate.length,
        canonicalDuplicatesSkipped: dedupeSkipped.length,
      });
    }

    const pages = await mapWithConcurrency(
      urlsToEstimate,
      INDEX_ESTIMATE_CONCURRENCY,
      async (url) => {
        try {
          const parsed = await parsePage(
            url,
            contentSelectors,
            excludeSelectors,
            source.config.userAgent,
          );
          const markdown = parsed.markdown.trim();
          return {
            url: parsed.url,
            title: parsed.title,
            charCount: markdown.length,
            estimatedChunks: estimateChunkCountFromMarkdown(markdown),
          };
        } catch (error) {
          return {
            url,
            title: url,
            charCount: 0,
            estimatedChunks: 0,
            error:
              error instanceof Error ? error.message : "Failed to parse page",
          };
        }
      },
    );

    const estimate = buildIndexSizeEstimate(
      pages,
      body.data.selectedUrlCount ?? body.data.urls.length,
    );

    return { estimate };
  });

  fastify.post("/api/sources/:id/query", async (request, reply) => {
    const userId = await requireUser(request, reply);
    if (!userId) return;

    const { id } = request.params as { id: string };
    const source = await getSourceForUser(id, userId);
    if (!source) {
      return reply.status(404).send({ error: "Source not found" });
    }

    const body = queryBodySchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: body.error.flatten() });
    }

    try {
      const result = await kapaRetrieve({
        query: body.data.query,
        sourceId: id,
        filter: body.data.filter,
      });

      return {
        vectorBackend: getVectorBackend(),
        ...result,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Query failed";
      logError(error instanceof Error ? error : message, "KapaQuery", {
        sourceId: id,
      });
      return reply.status(500).send({ error: message });
    }
  });
}
