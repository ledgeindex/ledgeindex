import { z } from "zod";
import {
  apiResponseMetaSchema,
  llmExtractedApiResponseFieldSchema,
} from "./api-response-meta.js";
import {
  EXAMPLE_LANGUAGES,
  normalizeExampleLanguage,
  type ExampleLanguage,
} from "./example-language.js";

export const EXAMPLE_KINDS = [
  "code",
  "setup",
  "usage",
  "config",
  "api_response",
  "other",
] as const;

export const exampleKindSchema = z.enum(EXAMPLE_KINDS);

export type ExampleKind = z.infer<typeof exampleKindSchema>;

export { EXAMPLE_LANGUAGES, normalizeExampleLanguage };
export type { ExampleLanguage };

export const exampleLanguageSchema = z.enum(EXAMPLE_LANGUAGES);

/**
 * LLM may return aliases (ts, js, dockerfile). Normalize into the enum before
 * validating so structured output does not fail the whole page.
 */
const llmExampleLanguageSchema = z.preprocess(
  (value) => {
    if (value === null || value === undefined) return null;
    if (typeof value !== "string") return null;
    return normalizeExampleLanguage(value);
  },
  exampleLanguageSchema.nullable(),
);

/** Structured LLM extract output. */
export const enrichLlmOutputSchema = z.object({
  page_summary: z.string(),
  extracted_examples: z.array(
    z.object({
      kind: exampleKindSchema,
      title: z.string().min(1),
      description: z.string().min(1),
      language: llmExampleLanguageSchema,
      body: z.string().min(1),
      /** Soft during LLM parse; we always resolve a required section afterward. */
      section: z.string().nullable().optional(),
      apiResponse: llmExtractedApiResponseFieldSchema,
    }),
  ),
});

export type EnrichLlmOutput = z.infer<typeof enrichLlmOutputSchema>;

export const enrichedExampleSchema = z.object({
  kind: exampleKindSchema,
  title: z.string(),
  description: z.string(),
  language: exampleLanguageSchema.nullable(),
  body: z.string(),
  section: z.string(),
  exampleIndex: z.number().int().nonnegative(),
  embedText: z.string(),
  confidence: z.literal("extracted"),
  apiResponse: apiResponseMetaSchema.nullable().optional(),
});

/**
 * Why a page was not enriched.
 * - info_only / empty_page / no_examples: heuristic skip (LLM never ran)
 * - no_llm: enrich model unavailable
 * - empty_extraction: LLM ran but returned nothing usable
 * - llm_failed: LLM error / invalid structured output
 *
 * `no_examples` kept for older runs / callers.
 */
export const enrichSkipReasonSchema = z.enum([
  "info_only",
  "empty_page",
  "no_examples",
  "no_llm",
  "empty_extraction",
  "llm_failed",
]);

export type EnrichSkipReason = z.infer<typeof enrichSkipReasonSchema>;

export const enrichPageResultSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("enriched"),
    pageSummary: z.string(),
    examples: z.array(enrichedExampleSchema),
    /** LLM enrich passes used (1 = whole page; >1 = packed section batches). */
    enrichPassCount: z.number().int().positive().optional(),
    /** Full page markdown size (before truncation). */
    markdownChars: z.number().int().nonnegative().optional(),
    /** gpt-tokenizer token count of the full page markdown. */
    estimatedTokens: z.number().int().nonnegative().optional(),
    /** Model context window used for limiting, when known. */
    contextTokenLimit: z.number().int().positive().optional(),
  }),
  z.object({
    status: z.literal("skipped"),
    reason: enrichSkipReasonSchema,
    /** Human-readable explanation for review UI. */
    detail: z.string().optional(),
    /** Full page markdown size (before truncation). */
    markdownChars: z.number().int().nonnegative().optional(),
    /** gpt-tokenizer token count of the full page markdown (before truncation). */
    estimatedTokens: z.number().int().nonnegative().optional(),
    /** Model context window used for limiting, when known. */
    contextTokenLimit: z.number().int().positive().optional(),
    /** LLM enrich passes used before skip (packed section batches). */
    enrichPassCount: z.number().int().positive().optional(),
  }),
]);

export type EnrichedExample = z.infer<typeof enrichedExampleSchema>;
export type { ApiResponseMeta } from "./api-response-meta.js";
export type EnrichPageResult = z.infer<typeof enrichPageResultSchema>;

/** Soft skips (no model failure) vs hard misses. */
export function isEnrichFailureReason(reason: string): boolean {
  return reason === "llm_failed" || reason === "empty_extraction";
}

export function enrichSkipReasonLabel(reason: string): string {
  switch (reason) {
    case "info_only":
      return "info only";
    case "empty_page":
      return "empty page";
    case "no_examples":
      return "no examples";
    case "no_llm":
      return "no llm";
    case "empty_extraction":
      return "empty extraction";
    case "llm_failed":
      return "llm failed";
    default:
      return reason.replaceAll("_", " ");
  }
}
