import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { MAX_CRAWL_PAGES } from "../schemas/source-config.js";
import {
  filterCrawlUrls,
  proposeCrawlFilterRemovals,
} from "../crawler/crawl-url-filter.js";
import { expandSitemapPageUrls } from "../crawler/sitemap.js";
import { DEFAULT_CRAWL_USER_AGENT } from "@ledgeindex/core/crawl/crawl-user-agent.js";
import { probePageStatus } from "@ledgeindex/core/crawl/validate-page-statuses.js";
import { mapWithConcurrency } from "@ledgeindex/core/lib/map-with-concurrency.js";
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

  /** Expand selected sitemap XML files into page URLs (for the sitemap picker modal). */
  fastify.post("/api/crawl/sitemap-pages", async (request, reply) => {
    const userId = await requireUser(request, reply);
    if (!userId) return;

    const body = z
      .object({
        sitemapUrls: z.array(z.string().url()).min(1).max(40),
        userAgent: z.string().min(1).max(400).optional(),
        maxPages: z.number().int().min(1).max(50_000).optional(),
      })
      .safeParse(request.body ?? {});

    if (!body.success) {
      return reply.status(400).send({ error: formatZodError(body.error) });
    }

    try {
      const urls = await expandSitemapPageUrls(
        body.data.sitemapUrls,
        body.data.userAgent?.trim() || DEFAULT_CRAWL_USER_AGENT,
        { maxPages: body.data.maxPages ?? 20_000 },
      );
      return {
        pages: {
          urls,
          total: urls.length,
          truncated: urls.length >= (body.data.maxPages ?? 20_000),
        },
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Sitemap expand failed";
      return reply.status(502).send({ error: message });
    }
  });

  /** Fetch robots.txt for the Robots discovery pill modal. */
  fastify.post("/api/crawl/robots-txt", async (request, reply) => {
    const userId = await requireUser(request, reply);
    if (!userId) return;

    const body = z
      .object({
        url: z.string().url(),
        userAgent: z.string().min(1).max(400).optional(),
      })
      .safeParse(request.body ?? {});

    if (!body.success) {
      return reply.status(400).send({ error: formatZodError(body.error) });
    }

    try {
      let robotsUrl = body.data.url.trim();
      try {
        const parsed = new URL(robotsUrl);
        if (!parsed.pathname.toLowerCase().endsWith("robots.txt")) {
          robotsUrl = `${parsed.origin}/robots.txt`;
        }
      } catch {
        return reply.status(400).send({ error: "Invalid URL" });
      }

      const userAgent =
        body.data.userAgent?.trim() || DEFAULT_CRAWL_USER_AGENT;
      const response = await fetch(robotsUrl, {
        headers: { "User-Agent": userAgent },
        signal: AbortSignal.timeout(12_000),
      });

      if (!response.ok) {
        return {
          robots: {
            url: robotsUrl,
            found: false,
            status: response.status,
            text: "",
          },
        };
      }

      const text = await response.text();
      return {
        robots: {
          url: robotsUrl,
          found: Boolean(text.trim()),
          status: response.status,
          text,
        },
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "robots.txt fetch failed";
      return reply.status(502).send({ error: message });
    }
  });

  /** HEAD/GET status probe for a batch of URLs (sitemap modal, etc.). */
  fastify.post("/api/crawl/probe-statuses", async (request, reply) => {
    const userId = await requireUser(request, reply);
    if (!userId) return;

    const body = z
      .object({
        urls: z.array(z.string().url()).min(1).max(200),
        userAgent: z.string().min(1).max(400).optional(),
        concurrency: z.number().int().min(1).max(16).optional(),
      })
      .safeParse(request.body ?? {});

    if (!body.success) {
      return reply.status(400).send({ error: formatZodError(body.error) });
    }

    const userAgent =
      body.data.userAgent?.trim() || DEFAULT_CRAWL_USER_AGENT;
    const concurrency = Math.min(16, body.data.concurrency ?? 12);

    try {
      const results = await mapWithConcurrency(
        body.data.urls,
        concurrency,
        (url) => probePageStatus(url, userAgent),
      );

      let okCount = 0;
      let nonOkCount = 0;
      for (const result of results) {
        if (result.ok) okCount += 1;
        else nonOkCount += 1;
      }

      return {
        probe: {
          results: results.map((result) => ({
            url: result.url,
            ok: result.ok,
            status: result.status,
            reason: result.reason,
          })),
          okCount,
          nonOkCount,
        },
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Status probe failed";
      return reply.status(502).send({ error: message });
    }
  });
}
