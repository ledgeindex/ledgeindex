import { z } from "zod";
import { webCrawlSourceConfigSchema } from "../../../schemas/source-config.js";

export const CRAWL_REVIEW_STEP_ID = "crawl-review-step";
export const PARSE_REVIEW_STEP_ID = "parse-review-step";
export const ENRICH_STEP_ID = "enrich-step";
export const EMBED_STEP_ID = "embed-step";
export const STORE_STEP_ID = "store-step";

export const WORKFLOW_ID = "ingest-web-crawl";

export const discoveredUrlSchema = z.object({
  url: z.string().url(),
  title: z.string().optional(),
});

export const skippedUrlSchema = z.object({
  url: z.string(),
  reason: z.string(),
});

export const parsedPageSchema = z.object({
  url: z.string().url(),
  title: z.string(),
  markdown: z.string(),
  error: z.string().optional(),
});

export const preparedChunkSchema = z.object({
  id: z.string(),
  text: z.string(),
  vector: z.array(z.number()),
  metadata: z.record(z.string(), z.unknown()),
});

export const ingestInputSchema = z.object({
  sourceId: z.string().min(1),
  projectId: z.string().min(1),
  config: webCrawlSourceConfigSchema,
  /**
   * Optional discovery handoff used when moving a reviewed crawl between
   * storage/scope backends. The target backend still fetches and parses every
   * selected page itself.
   */
  discoveryResult: z
    .object({
      urls: z.array(discoveredUrlSchema),
      skipped: z.array(skippedUrlSchema).default([]),
      httpStatusFiltered: z.number().int().nonnegative().optional(),
    })
    .optional(),
});

export const ingestOutputSchema = z.object({
  sourceId: z.string(),
  chunkCount: z.number(),
  pageCount: z.number(),
  catalogUpdatedAt: z.string().optional(),
});

export const ingestStateSchema = z.object({
  sourceId: z.string(),
  projectId: z.string(),
  config: webCrawlSourceConfigSchema,
  /** When false, enrich-step skips LLM example extraction. */
  enrichExamples: z.boolean().optional(),
  /** api | lm-studio | ag-native — chosen at crawl review. */
  enrichBackend: z.string().optional(),
  enrichModelId: z.string().optional(),
  enrichBaseUrl: z.string().optional(),
  enrichGoogleModelId: z.string().optional(),
  /** Model context window (tokens) from AutomationGhost / LM Studio. */
  enrichContextTokenLimit: z.number().int().positive().optional(),
  /** Held across parse-review / enrich-step suspend → resume. */
  parsedPages: z.array(z.any()).optional(),
  enrichedPages: z.array(z.any()).optional(),
});

export type IngestInput = z.infer<typeof ingestInputSchema>;
export type IngestOutput = z.infer<typeof ingestOutputSchema>;
export type ParsedPage = z.infer<typeof parsedPageSchema>;
export type PreparedChunk = z.infer<typeof preparedChunkSchema>;
