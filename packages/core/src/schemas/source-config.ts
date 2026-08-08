import { z } from "zod";
import { sourceMetadataSchema } from "./source-metadata.js";

export const MAX_CRAWL_PAGES = 1_000;
export const DEFAULT_MAX_CRAWL_PAGES = 1_000;

export const webCrawlSourceConfigSchema = z.object({
  startUrls: z.array(z.string().url()).min(1),
  includePatterns: z.array(z.string()).default([]),
  excludePatterns: z.array(z.string()).default([]),
  excludeDownloadPatterns: z.array(z.string()).default([]),
  patternsAreRegex: z.boolean().default(false),
  renderJs: z.boolean().default(false),
  useProxy: z.boolean().default(false),
  enableSitemap: z.boolean().default(true),
  /** When true, skip HTML link crawling and use sitemap URLs only. */
  sitemapOnly: z.boolean().default(false),
  sitemapUrls: z.array(z.string().url()).default([]),
  fileTypes: z.array(z.enum(["html", "pdf"])).default(["html"]),
  contentSelectors: z.array(z.string()).default([]),
  excludeSelectors: z.array(z.string()).default([]),
  maxPages: z.number().int().positive().max(MAX_CRAWL_PAGES).default(DEFAULT_MAX_CRAWL_PAGES),
  modifiedAfter: z.string().datetime().optional(),
  userAgent: z
    .string()
    .min(1)
    .default(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    ),
});

export type WebCrawlSourceConfig = z.infer<typeof webCrawlSourceConfigSchema>;

export const sourceTypeSchema = z.enum(["web_crawl"]);

export const sourceScopeSchema = z.enum(["personal", "global"]);

export const sourceHostingSchema = z.enum(["local", "cloud"]);

export const createSourceBodySchema = z
  .object({
    projectId: z.string().uuid().optional(),
    name: z.string().min(1).max(200),
    slug: z.string().min(1).max(64).optional(),
    type: sourceTypeSchema,
    scope: sourceScopeSchema.default("personal"),
    /** Where to store the index. Ignored on cloud-only deployments (always cloud). */
    hosting: sourceHostingSchema.optional(),
    config: webCrawlSourceConfigSchema,
    sourceMetadata: sourceMetadataSchema.nullable().optional(),
    versionMode: z.enum(["new", "replace"]).optional(),
    replaceSourceId: z.string().uuid().optional(),
    versionLabel: z.string().min(1).max(120).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.scope === "personal" && !value.projectId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "projectId is required for personal sources",
        path: ["projectId"],
      });
    }
  });

export type CreateSourceBody = z.infer<typeof createSourceBodySchema>;
