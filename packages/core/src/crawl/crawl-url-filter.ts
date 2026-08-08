// @ts-nocheck
import { Agent } from "@mastra/core/agent";
import { z } from "zod";
import {
  GEMINI_3_5_FLASH_LITE_CATALOG_ID,
  resolveChatModelConfig,
} from "../llm/chat-model-config.js";
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

  const modelId = input.modelId?.trim() || GEMINI_3_5_FLASH_LITE_CATALOG_ID;
  return { model: resolveChatModelConfig(modelId), modelId };
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
