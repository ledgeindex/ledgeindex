import type { QueryResult } from "@mastra/core/vector";
import type { RerankResult } from "@mastra/rag";
import { logVerbose, logWarn } from "../lib/logger.js";
import { SEARCH_TOP_K } from "../vector/constants.js";
import { combineWeightedRerankScores } from "./weighted-rerank.js";

export const COHERE_RERANK_MODEL_V35 = "rerank-v3.5";
export const COHERE_RERANK_MODEL_V4_FAST = "rerank-v4.0-fast";

/** @deprecated Prefer COHERE_RERANK_MODEL_V35 — kept for older imports. */
export const DEFAULT_COHERE_RERANK_MODEL = COHERE_RERANK_MODEL_V35;

export function getCohereApiKey(): string | undefined {
  return process.env.COHERE_API_KEY?.trim() || undefined;
}

export function getCohereRerankModel(): string {
  return (
    process.env.LEDGEINDEX_COHERE_RERANK_MODEL?.trim() ||
    COHERE_RERANK_MODEL_V35
  );
}

export function hasCohereKey(): boolean {
  return Boolean(getCohereApiKey());
}

type CohereRerankResponse = {
  results?: Array<{
    index?: number;
    relevance_score?: number;
  }>;
};

/** One in-flight Cohere call at a time — avoids trial-key 429s without blocking embed/vector. */
let cohereRerankLock: Promise<unknown> = Promise.resolve();

function withCohereRerankLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = cohereRerankLock.then(fn, fn);
  cohereRerankLock = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function cohereBatchRerankUnlocked(input: {
  query: string;
  results: QueryResult[];
  topK?: number;
  model?: string;
  apiKey?: string;
}): Promise<RerankResult[]> {
  const { query, results, topK = SEARCH_TOP_K } = input;
  if (results.length === 0) return [];

  const apiKey = input.apiKey ?? getCohereApiKey();
  if (!apiKey) {
    throw new Error("COHERE_API_KEY is required for Cohere reranking");
  }

  const model = input.model ?? getCohereRerankModel();
  const documents = results.map((result) =>
    String(result.metadata?.text ?? "").slice(0, 4000),
  );

  const response = await fetch("https://api.cohere.com/v2/rerank", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      query,
      documents,
      top_n: documents.length,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Cohere rerank error: ${response.status} ${body}`);
  }

  const data = (await response.json()) as CohereRerankResponse;
  const semanticByIndex = new Map<number, number>();

  for (const entry of data.results ?? []) {
    const index = Number(entry.index);
    const score = Number(entry.relevance_score);
    if (
      Number.isInteger(index) &&
      index >= 0 &&
      index < results.length &&
      Number.isFinite(score)
    ) {
      semanticByIndex.set(index, Math.min(1, Math.max(0, score)));
    }
  }

  if (semanticByIndex.size === 0) {
    throw new Error("Cohere rerank returned no relevance scores");
  }

  logVerbose("Cohere batch rerank complete", "CohereRerank", {
    model,
    documentCount: documents.length,
    scoredCount: semanticByIndex.size,
  });

  return combineWeightedRerankScores({
    results,
    semanticByIndex,
    topK,
  });
}

/**
 * One Cohere /v2/rerank call for all candidates (true batch).
 * Serialized globally so multi-query retrieval can run embed/vector in parallel.
 */
export async function cohereBatchRerank(
  input: Parameters<typeof cohereBatchRerankUnlocked>[0],
): Promise<RerankResult[]> {
  return withCohereRerankLock(() => cohereBatchRerankUnlocked(input));
}

export async function cohereBatchRerankSafe(
  input: Parameters<typeof cohereBatchRerank>[0],
): Promise<RerankResult[]> {
  try {
    return await cohereBatchRerank(input);
  } catch (error) {
    logWarn(
      error instanceof Error ? error.message : "Cohere rerank failed",
      "CohereRerank",
      { documentCount: input.results.length },
    );
    throw error;
  }
}
