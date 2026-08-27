import { Agent } from "@mastra/core/agent";
import { z } from "zod";
import type { KapaRetrievedChunk } from "./kapa-retrieve.js";
import {
  primaryAuxiliaryModelId,
  resolveRewriteModelConfig,
} from "../llm/chat-model-config.js";
import { agentStructuredOutput } from "../llm/agent-structured-output.js";
import { logVerbose, logWarn } from "../lib/logger.js";
import { COVERAGE_FULL_MAX_SCORE } from "../vector/constants.js";

const FILTER_TEMPERATURE = 0;
const MAX_PAGES = 8;
const PREVIEW_CHARS = 280;

export type DroppedRetrievedPage = {
  url: string;
  title: string;
  reason: string;
};

export type PageKeepDecision = {
  url: string;
  keep: boolean;
  reason: string;
};

export type FilterRetrievedPagesResult = {
  kept: KapaRetrievedChunk[];
  dropped: DroppedRetrievedPage[];
  usedFilter: boolean;
  modelId?: string;
};

const filterOutputSchema = z.object({
  pages: z
    .array(
      z.object({
        url: z.string().min(1),
        keep: z.boolean(),
        reason: z.string().min(1).max(160),
      }),
    )
    .min(1)
    .max(MAX_PAGES),
});

const FILTER_INSTRUCTIONS = `You decide which retrieved documentation pages the answer agent is allowed to see.

Search already scored these pages. A high score only means the text looks similar to the question. It does not mean the page answers it. A "basic configuration" section of an unrelated API is a typical false hit for "what is the basic setup".

keep=true: a careful reader could use this page to answer the user's question.
keep=false: different topic, different API, or it only shares generic words (setup, basic, configure, install).

When you are unsure, keep=true. Catalog titles in the prompt are hints about likely areas, not a whitelist.`;

export type RetrievedPageSummary = {
  url: string;
  title: string;
  score: number;
  preview: string;
};

function stripLlmsPreamble(text: string): string {
  return text
    .replace(
      /^[\s>]*Discover all available pages from the documentation index:[\s\S]*?https?:\/\/\S+\s*/i,
      "",
    )
    .trim();
}

function pagePreview(text: string): string {
  const stripped = stripLlmsPreamble(text);
  if (stripped.length <= PREVIEW_CHARS) return stripped;
  return `${stripped.slice(0, PREVIEW_CHARS)}…`;
}

export function summarizeRetrievedPages(
  chunks: KapaRetrievedChunk[],
): RetrievedPageSummary[] {
  const byUrl = new Map<string, RetrievedPageSummary>();
  for (const chunk of chunks) {
    const url = chunk.url.trim();
    if (!url) continue;
    const existing = byUrl.get(url);
    if (existing && existing.score >= chunk.score) continue;
    byUrl.set(url, {
      url,
      title: chunk.title.trim() || url,
      score: chunk.score,
      preview: pagePreview(chunk.text),
    });
  }
  return [...byUrl.values()]
    .sort((left, right) => right.score - left.score)
    .slice(0, MAX_PAGES);
}

export function applyPageKeepDecisions(
  chunks: KapaRetrievedChunk[],
  decisions: PageKeepDecision[],
): { kept: KapaRetrievedChunk[]; dropped: DroppedRetrievedPage[] } {
  if (decisions.length === 0) {
    return { kept: chunks, dropped: [] };
  }

  const byUrl = new Map(
    decisions.map((decision) => [decision.url.trim(), decision]),
  );
  const droppedByUrl = new Map<string, DroppedRetrievedPage>();
  const kept: KapaRetrievedChunk[] = [];

  for (const chunk of chunks) {
    const url = chunk.url.trim();
    const decision = byUrl.get(url);
    if (!decision || decision.keep) {
      kept.push(chunk);
      continue;
    }
    if (!droppedByUrl.has(url)) {
      droppedByUrl.set(url, {
        url,
        title: chunk.title.trim() || url,
        reason: decision.reason,
      });
    }
  }

  return { kept, dropped: [...droppedByUrl.values()] };
}

/**
 * Skip the extra model call when retrieval is already a confident, on-threshold
 * hit. Run it when scores are in the relaxed/weak band, or when a single page
 * would otherwise own the whole answer.
 */
export function shouldFilterRetrievedPages(input: {
  cascadePassUsed?: boolean;
  relaxedPassUsed?: boolean;
  weakEvidenceUsed?: boolean;
  uniquePageCount: number;
  maxChunkScore?: number;
}): boolean {
  if (input.cascadePassUsed) return false;
  if (input.uniquePageCount === 0) return false;
  if (input.relaxedPassUsed || input.weakEvidenceUsed) return true;
  if (input.uniquePageCount === 1) return true;
  return (input.maxChunkScore ?? 0) < COVERAGE_FULL_MAX_SCORE;
}

export async function maybeFilterRetrievedPages(input: {
  question: string;
  chunks: KapaRetrievedChunk[];
  catalogQueries?: string[];
  requestContext?: { get?: (key: string) => unknown };
  relaxedPassUsed?: boolean;
  weakEvidenceUsed?: boolean;
  cascadePassUsed?: boolean;
}): Promise<FilterRetrievedPagesResult> {
  const uniquePageCount = new Set(
    input.chunks.map((chunk) => chunk.url.trim()).filter(Boolean),
  ).size;
  const maxChunkScore = input.chunks
    .filter((chunk) => chunk.retrievalKind !== "expanded")
    .reduce((max, chunk) => Math.max(max, chunk.score), 0);

  if (
    !shouldFilterRetrievedPages({
      cascadePassUsed: input.cascadePassUsed,
      relaxedPassUsed: input.relaxedPassUsed,
      weakEvidenceUsed: input.weakEvidenceUsed,
      uniquePageCount,
      maxChunkScore,
    })
  ) {
    return { kept: input.chunks, dropped: [], usedFilter: false };
  }

  return filterRetrievedPages(input);
}

export async function filterRetrievedPages(input: {
  question: string;
  chunks: KapaRetrievedChunk[];
  catalogQueries?: string[];
  requestContext?: { get?: (key: string) => unknown };
}): Promise<FilterRetrievedPagesResult> {
  const pages = summarizeRetrievedPages(input.chunks);
  if (pages.length === 0) {
    return { kept: input.chunks, dropped: [], usedFilter: false };
  }

  const model = resolveRewriteModelConfig(input.requestContext);
  const modelId = primaryAuxiliaryModelId(input.requestContext);
  const agent = new Agent({
    id: "retrieved-page-filter-agent",
    name: "Retrieved Page Filter",
    instructions: FILTER_INSTRUCTIONS,
    model,
  });

  const catalogLine =
    input.catalogQueries && input.catalogQueries.length > 0
      ? `Catalog titles searched: ${input.catalogQueries.join("; ")}`
      : "Catalog titles searched: (none)";

  try {
    const object = await agentStructuredOutput(
      agent,
      [
        `Question: ${input.question}`,
        catalogLine,
        "",
        "Retrieved pages:",
        JSON.stringify(pages),
      ].join("\n"),
      filterOutputSchema,
      { temperature: FILTER_TEMPERATURE },
    );

    if (!object) {
      logWarn("Retrieved page filter returned no object", "PageFilter", {
        question: input.question,
        pageCount: pages.length,
      });
      return { kept: input.chunks, dropped: [], usedFilter: false, modelId };
    }

    const applied = applyPageKeepDecisions(input.chunks, object.pages);
    logVerbose("Retrieved page filter finished", "PageFilter", {
      question: input.question,
      keptPages: new Set(applied.kept.map((chunk) => chunk.url)).size,
      dropped: applied.dropped.map((page) => page.title),
      modelId,
    });
    return { ...applied, usedFilter: true, modelId };
  } catch (error) {
    logWarn(
      error instanceof Error ? error.message : "Retrieved page filter failed",
      "PageFilter",
      { question: input.question },
    );
    return { kept: input.chunks, dropped: [], usedFilter: false, modelId };
  }
}
