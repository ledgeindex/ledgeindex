// @ts-nocheck
import { Agent } from "@mastra/core/agent";
import { z } from "zod";
import {
  GEMINI_3_5_FLASH_LITE_CATALOG_ID,
  resolveChatModelConfig,
} from "../llm/chat-model-config.js";
import {
  crawlModelIdForProvider,
  resolveConfiguredCrawlProvider,
} from "../llm/crawl-provider.js";
import {
  resolveEnrichModelFromSelection,
  type LedgeIndexLlmModel,
} from "../llm/models.js";
import { logVerbose, logWarn } from "../lib/logger.js";
import { MAX_CRAWL_PAGES } from "../schemas/source-config.js";

/** Max URLs included in a single LLM prompt (matches crawl page cap). */
export const CRAWL_URL_FILTER_LLM_URLS = MAX_CRAWL_PAGES;

const crawlUrlFilterOutputSchema = z.object({
  selectedIndexes: z.array(z.number().int().min(0)),
  summary: z.string(),
});

export type CrawlUrlFilterEntry = {
  index: number;
  url: string;
  title?: string;
};

export type CrawlUrlFilterMessage = {
  role: "user" | "assistant";
  content: string;
};

export type CrawlUrlFilterResult = {
  selectedIndexes: number[];
  summary: string;
  modelId: string;
  truncated?: boolean;
  totalUrls?: number;
};

/** Same shape as enrich resume — api / lm-studio / ag-native. */
export type CrawlUrlFilterModelSelection = {
  backend?: string | null;
  modelId?: string | null;
  baseUrl?: string | null;
  googleModelId?: string | null;
};

const FILTER_INSTRUCTIONS = `You help users filter a numbered list of crawled URLs before indexing.

You always return the complete new selection as 0-based indexes in selectedIndexes.

Interpret the user's intent:
- "only …" / "just …" / "keep …" → replace selection with URLs matching the criteria
- "add …" / "also include …" → union with the current selection
- "remove …" / "exclude …" / "deselect …" → remove matching URLs from current selection
- "select all" → every index
- "clear" / "deselect all" / "none" → empty array

Use URL paths (\`p\`), slugs, titles, and common site patterns (api, docs, reference, guides, blog, changelog, pricing, legal, etc.).
Prefer precision over recall when the user names a topic.

Error / missing pages:
- Titles are included when available. Treat clearly broken pages as noise: titles that indicate the page is missing or an error (for example "Page not found", "404", "GitHub Pages" not-found pages, "does not exist").
- Unless the user explicitly asks to keep error/missing pages, never leave those indexes selected. When applying any filter, start from the user's intent and also drop those broken pages from the result.
- If the user only asks to remove not-found/error pages, deselect those and keep everything else that was selected.

The UI shows 1-based row numbers for humans, but you must output 0-based indexes matching the \`i\` field in the URL list.
If nothing matches, return an empty selectedIndexes array and explain why in summary.`;

function formatHistory(messages: CrawlUrlFilterMessage[]): string {
  if (messages.length === 0) return "";
  return messages
    .slice(-8)
    .map((message) => `${message.role}: ${message.content}`)
    .join("\n");
}

function compactUrlList(urls: CrawlUrlFilterEntry[]): string {
  return JSON.stringify(
    urls.map((entry) => {
      let path = entry.url;
      try {
        const parsed = new URL(entry.url);
        path = `${parsed.pathname}${parsed.search}`;
      } catch {
        // keep full url
      }
      return {
        i: entry.index,
        p: path,
        ...(entry.title?.trim() ? { title: entry.title.trim() } : {}),
      };
    }),
  );
}

function resolveFilterModel(input: {
  modelId?: string;
  model?: CrawlUrlFilterModelSelection | null;
}): { model: LedgeIndexLlmModel; modelId: string } {
  const fromSelection = resolveEnrichModelFromSelection(input.model ?? null);
  if (fromSelection) {
    const modelId =
      typeof fromSelection === "string"
        ? fromSelection
        : input.model?.googleModelId?.trim() ||
          input.model?.modelId?.trim() ||
          "custom";
    return { model: fromSelection, modelId };
  }

  const configured = resolveConfiguredCrawlProvider();
  const modelId =
    input.modelId?.trim() ||
    (configured
      ? crawlModelIdForProvider(configured)
      : GEMINI_3_5_FLASH_LITE_CATALOG_ID);
  return { model: resolveChatModelConfig(modelId), modelId };
}

const crawlUrlRemovalsOutputSchema = z.object({
  /** 0-based indexes to drop from the crawl list / selection. */
  removeIndexes: z.array(z.number().int().min(0)),
  /** Path exclude patterns to persist (version trees, blog, …). */
  excludePatterns: z.array(z.string()).default([]),
  summary: z.string(),
});

export type CrawlUrlRemovalsResult = {
  removeIndexes: number[];
  excludePatterns: string[];
  selectedIndexes: number[];
  summary: string;
  modelId: string;
  truncated?: boolean;
  totalUrls?: number;
};

const REMOVALS_INSTRUCTIONS = `You clean a crawled docs URL list before indexing.

You receive a compact catalog of entries: index (i), path (p), and title (t when present).
Return ONLY what should be removed — not the full keep list.

Output:
- removeIndexes: 0-based indexes to drop (broken/missing pages, one-off junk)
- excludePatterns: short path substrings to exclude going forward (version trees, blog, changelog, locales, …)
- summary: one short sentence

Rules:
1. Prefer excludePatterns for whole trees (e.g. /blog/, /v1/, /changelog/).
2. Prefer removeIndexes for individual broken pages — especially titles that clearly mean the page is missing/error (Page not found, 404, GitHub Pages not-found, does not exist).
3. Do not remove the primary/current docs tree that matches the start URL scope.
4. If nothing should be removed, return empty arrays and say so in summary.
5. Indexes must match the \`i\` field in the catalog.`;

function compactRemovalCatalog(urls: CrawlUrlFilterEntry[]): string {
  return urls
    .map((entry) => {
      let path = entry.url;
      try {
        const parsed = new URL(entry.url);
        path = `${parsed.pathname}${parsed.search}`;
      } catch {
        // keep full url
      }
      const title = entry.title?.trim();
      return title
        ? `${entry.index}|${path}|${title}`
        : `${entry.index}|${path}`;
    })
    .join("\n");
}

/**
 * Filter-versions style pass: AI returns removals + exclude patterns
 * (compact index|path|title catalog — not a full keep-list).
 */
export async function proposeCrawlFilterRemovals(input: {
  urls: CrawlUrlFilterEntry[];
  startUrls?: string[];
  modelId?: string;
  model?: CrawlUrlFilterModelSelection | null;
}): Promise<CrawlUrlRemovalsResult> {
  const totalUrls = input.urls.length;
  const urls = input.urls.slice(0, CRAWL_URL_FILTER_LLM_URLS);
  const truncated = totalUrls > urls.length;
  const maxIndex = Math.max(0, totalUrls - 1);
  const { model, modelId } = resolveFilterModel(input);

  const agent = new Agent({
    id: "crawl-url-removals-agent",
    name: "Crawl URL Removals",
    instructions: REMOVALS_INSTRUCTIONS,
    model,
  });

  const prompt = [
    `Start URLs: ${(input.startUrls ?? []).join(", ") || "(none)"}`,
    `Catalog size: ${totalUrls} (listed ${urls.length}). Index range 0..${maxIndex}.`,
    truncated
      ? `Only the first ${urls.length} rows are listed — still use global indexes when removing.`
      : null,
    "",
    "Catalog format: index|path|title",
    compactRemovalCatalog(urls),
    "",
    "Return removeIndexes + excludePatterns for version/noise trees and broken/not-found pages.",
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");

  try {
    const result = await agent.generate(prompt, {
      maxSteps: 1,
      structuredOutput: {
        schema: crawlUrlRemovalsOutputSchema,
      },
    });

    const removeIndexes = [
      ...new Set(
        (result.object?.removeIndexes ?? []).filter(
          (index) => Number.isInteger(index) && index >= 0 && index <= maxIndex,
        ),
      ),
    ].sort((a, b) => a - b);

    const removeSet = new Set(removeIndexes);
    const selectedIndexes = Array.from({ length: totalUrls }, (_, index) => index).filter(
      (index) => !removeSet.has(index),
    );

    const excludePatterns = [
      ...new Set(
        (result.object?.excludePatterns ?? [])
          .map((pattern) => pattern.trim())
          .filter(Boolean),
      ),
    ];

    let summary =
      result.object?.summary?.trim() ||
      `Removed ${removeIndexes.length} URL(s); ${excludePatterns.length} exclude pattern(s).`;

    if (truncated) {
      summary = `${summary} (AI only saw the first ${urls.length} of ${totalUrls} URLs.)`;
    }

    logVerbose("Crawl URL removals finished", "CrawlUrlFilter", {
      urlCount: urls.length,
      removeCount: removeIndexes.length,
      excludePatternCount: excludePatterns.length,
      modelId,
    });

    return {
      removeIndexes,
      excludePatterns,
      selectedIndexes,
      summary,
      modelId,
      ...(truncated ? { truncated: true, totalUrls } : {}),
    };
  } catch (error) {
    logWarn(
      error instanceof Error ? error.message : "Crawl URL removals failed",
      "CrawlUrlFilter",
    );
    throw error;
  }
}

export async function filterCrawlUrls(input: {
  message: string;
  urls: CrawlUrlFilterEntry[];
  selectedIndexes: number[];
  history?: CrawlUrlFilterMessage[];
  /** Legacy catalog id (e.g. google/gemini-3.5-flash-lite). */
  modelId?: string;
  /** Preferred: api / lm-studio / ag-native selection with optional baseUrl. */
  model?: CrawlUrlFilterModelSelection | null;
}): Promise<CrawlUrlFilterResult> {
  const totalUrls = input.urls.length;
  const urls = input.urls.slice(0, CRAWL_URL_FILTER_LLM_URLS);
  const truncated = totalUrls > urls.length;
  const maxIndex = totalUrls - 1;
  const { model, modelId } = resolveFilterModel(input);

  const agent = new Agent({
    id: "crawl-url-filter-agent",
    name: "Crawl URL Filter",
    instructions: FILTER_INSTRUCTIONS,
    model,
  });

  const prompt = [
    `Valid index range: 0 to ${maxIndex} (${totalUrls} URLs total).`,
    truncated
      ? `Only the first ${urls.length} URLs are listed below — still output global indexes for the full list when possible.`
      : null,
    `Current selected indexes: ${JSON.stringify(input.selectedIndexes)}`,
    "",
    "Conversation so far:",
    formatHistory(input.history ?? []) || "(none)",
    "",
    `User message: ${input.message.trim()}`,
    "",
    "Numbered URL list:",
    compactUrlList(urls),
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");

  try {
    const result = await agent.generate(prompt, {
      maxSteps: 1,
      structuredOutput: {
        schema: crawlUrlFilterOutputSchema,
      },
    });

    const rawIndexes = result.object?.selectedIndexes ?? [];
    const selectedIndexes = [
      ...new Set(
        rawIndexes.filter(
          (index) => Number.isInteger(index) && index >= 0 && index <= maxIndex,
        ),
      ),
    ].sort((a, b) => a - b);

    let summary =
      result.object?.summary?.trim() ||
      `Updated selection to ${selectedIndexes.length} URL(s).`;

    if (truncated) {
      summary = `${summary} (AI only saw the first ${urls.length} of ${totalUrls} URLs — narrow your crawl for better results.)`;
    }

    logVerbose("Crawl URL filter finished", "CrawlUrlFilter", {
      urlCount: urls.length,
      selectedCount: selectedIndexes.length,
      modelId,
    });

    return {
      selectedIndexes,
      summary,
      modelId,
      ...(truncated ? { truncated: true, totalUrls } : {}),
    };
  } catch (error) {
    logWarn(
      error instanceof Error ? error.message : "Crawl URL filter failed",
      "CrawlUrlFilter",
    );
    throw error;
  }
}
