import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { MAX_CRAWL_PAGES } from "../schemas/source-config.js";
import {
  filterCrawlUrls,
  proposeCrawlFilterRemovals,
} from "../crawler/crawl-url-filter.js";
import { requireUser } from "../lib/resource-access.js";

function formatZodError(error: z.ZodError): string {
  const parts = error.issues.map((issue) => {
    const path = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
    return `${path}${issue.message}`;
  });
  return parts.join("; ") || "Invalid request";
}

const urlEntrySchema = z.object({
  index: z.number().int().min(0),
  url: z.string().min(1),
  title: z.string().nullish(),
});

const modelSelectionSchema = z
  .object({
    backend: z.string().min(1).optional(),
    modelId: z.string().min(1).optional(),
    baseUrl: z.string().min(1).optional(),
    googleModelId: z.string().min(1).optional(),
  })
  .optional();

const bodySchema = z.object({
  message: z.string().min(1).max(2000),
  urls: z.array(urlEntrySchema).min(1).max(MAX_CRAWL_PAGES),
  selectedIndexes: z.array(z.number().int().min(0)).default([]),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(2000),
      }),
    )
    .max(20)
    .optional(),
  modelId: z.string().optional(),
  /** Preferred over modelId when present (api / lm-studio / ag-native). */
  model: modelSelectionSchema,
  /** Flat aliases (Electron enrich-style payload). */
  backend: z.string().optional(),
  baseUrl: z.string().optional(),
  googleModelId: z.string().optional(),
});

const removalsBodySchema = z.object({
  urls: z.array(urlEntrySchema).min(1).max(MAX_CRAWL_PAGES),
  startUrls: z.array(z.string().min(1)).max(20).optional(),
  modelId: z.string().optional(),
  model: modelSelectionSchema,
  backend: z.string().optional(),
  baseUrl: z.string().optional(),
  googleModelId: z.string().optional(),
});

export async function crawlFilterRoutes(fastify: FastifyInstance) {
  fastify.post("/api/crawl/url-filter", async (request, reply) => {
    const userId = await requireUser(request, reply);
    if (!userId) return;

    const body = bodySchema.safeParse(request.body ?? {});
    if (!body.success) {
      return reply.status(400).send({ error: formatZodError(body.error) });
    }

    const model =
      body.data.model ??
      (body.data.backend
        ? {
            backend: body.data.backend,
            modelId: body.data.modelId,
            baseUrl: body.data.baseUrl,
            googleModelId: body.data.googleModelId,
          }
        : undefined);

    try {
      const result = await filterCrawlUrls({
        message: body.data.message,
        selectedIndexes: body.data.selectedIndexes,
        history: body.data.history,
        modelId: body.data.modelId,
        model,
        urls: body.data.urls.map((entry) => ({
          index: entry.index,
          url: entry.url,
          title: entry.title?.trim() || undefined,
        })),
      });
      return { filter: result };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "URL filter failed";
      return reply.status(502).send({ error: message });
    }
  });

  /** Filter versions: AI returns removeIndexes + excludePatterns (not a keep-list). */
  fastify.post("/api/crawl/url-removals", async (request, reply) => {
    const userId = await requireUser(request, reply);
    if (!userId) return;

    const body = removalsBodySchema.safeParse(request.body ?? {});
    if (!body.success) {
      return reply.status(400).send({ error: formatZodError(body.error) });
    }

    const model =
      body.data.model ??
      (body.data.backend
        ? {
            backend: body.data.backend,
            modelId: body.data.modelId,
            baseUrl: body.data.baseUrl,
            googleModelId: body.data.googleModelId,
          }
        : undefined);

    try {
      const result = await proposeCrawlFilterRemovals({
        startUrls: body.data.startUrls,
        modelId: body.data.modelId,
        model,
        urls: body.data.urls.map((entry) => ({
          index: entry.index,
          url: entry.url,
          title: entry.title?.trim() || undefined,
        })),
      });
      return { removals: result };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "URL removals failed";
      return reply.status(502).send({ error: message });
    }
  });
}
