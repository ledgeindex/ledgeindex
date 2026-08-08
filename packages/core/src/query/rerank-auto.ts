import type { QueryResult } from "@mastra/core/vector";
import type { RerankResult } from "@mastra/rag";
import { logVerbose } from "../lib/logger.js";
import { SEARCH_TOP_K } from "../vector/constants.js";
import {
  COHERE_RERANK_MODEL_V35,
  COHERE_RERANK_MODEL_V4_FAST,
  cohereBatchRerank,
} from "./cohere-batch-rerank.js";
import {
  LOCAL_RERANK_MODEL_MINILM,
  LOCAL_RERANK_MODEL_MINILM_L12,
  scoreDocumentsInProcess,
} from "./local-bge-inprocess.js";
import { localBatchRerank } from "./local-batch-rerank.js";
import { combineWeightedRerankScores } from "./weighted-rerank.js";

/** Weak / close top hits → escalate to a stronger CE. */
export function isAmbiguousSemanticRanking(semanticScores: number[]): boolean {
  const sorted = [...semanticScores]
    .filter((score) => Number.isFinite(score))
    .sort((a, b) => b - a);
  if (sorted.length === 0) return true;

  const top = sorted[0] ?? 0;
  const second = sorted[1] ?? 0;
  const third = sorted[2];

  if (top < 0.7) return true;
  if (sorted.length >= 2 && top - second < 0.08) return true;
  if (typeof third === "number" && top - third < 0.12) return true;
  return false;
}

const LOCAL_AUTO_ESCALATE_TOP_N = 10;

/**
 * Local Auto: MiniLM L6 first; if rankings look ambiguous, re-score top-N with L12.
 */
export async function localAutoBatchRerank(input: {
  query: string;
  results: QueryResult[];
  topK?: number;
}): Promise<RerankResult[]> {
  const { query, results, topK = SEARCH_TOP_K } = input;
  if (results.length === 0) return [];

  const documents = results.map((result) =>
    String(result.metadata?.text ?? "").slice(0, 4000),
  );

  const l6Scores = await scoreDocumentsInProcess(
    query,
    documents,
    LOCAL_RERANK_MODEL_MINILM,
  );

  if (!isAmbiguousSemanticRanking(l6Scores)) {
    logVerbose("Local auto kept MiniLM L6", "RerankAuto", {
      documentCount: documents.length,
      top: Math.max(...l6Scores, 0),
    });
    return combineWeightedRerankScores({
      results,
      semanticByIndex: scoresToMap(l6Scores),
      topK,
    });
  }

  const ranked = l6Scores
    .map((score, index) => ({ score, index }))
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.min(LOCAL_AUTO_ESCALATE_TOP_N, documents.length));

  const subsetDocs = ranked.map((entry) => documents[entry.index] ?? "");
  const l12Scores = await scoreDocumentsInProcess(
    query,
    subsetDocs,
    LOCAL_RERANK_MODEL_MINILM_L12,
  );

  const merged = scoresToMap(l6Scores);
  ranked.forEach((entry, i) => {
    const score = l12Scores[i];
    if (typeof score === "number" && Number.isFinite(score)) {
      merged.set(entry.index, score);
    }
  });

  logVerbose("Local auto escalated to MiniLM L12", "RerankAuto", {
    documentCount: documents.length,
    escalatedCount: ranked.length,
  });

  return combineWeightedRerankScores({
    results,
    semanticByIndex: merged,
    topK,
  });
}

/**
 * Cloud Auto: Cohere 3.5 first; if ambiguous, re-run with Cohere 4 (fast).
 */
export async function cohereAutoBatchRerank(input: {
  query: string;
  results: QueryResult[];
  topK?: number;
}): Promise<RerankResult[]> {
  const { query, results, topK = SEARCH_TOP_K } = input;
  if (results.length === 0) return [];

  const first = await cohereBatchRerank({
    query,
    results,
    topK: results.length,
    model: COHERE_RERANK_MODEL_V35,
  });
  const semantics = first.map((entry) => Number(entry.details?.semantic ?? 0));

  if (!isAmbiguousSemanticRanking(semantics)) {
    logVerbose("Cloud auto kept Cohere 3.5", "RerankAuto", {
      documentCount: results.length,
      top: Math.max(...semantics, 0),
    });
    return first.slice(0, topK);
  }

  logVerbose("Cloud auto escalated to Cohere 4", "RerankAuto", {
    documentCount: results.length,
  });
  return cohereBatchRerank({
    query,
    results,
    topK,
    model: COHERE_RERANK_MODEL_V4_FAST,
  });
}

/** Fallback helper used when in-process scoring isn't available for auto path. */
export async function localAutoBatchRerankOrFallback(input: {
  query: string;
  results: QueryResult[];
  topK?: number;
}): Promise<RerankResult[]> {
  try {
    return await localAutoBatchRerank(input);
  } catch {
    return localBatchRerank({
      ...input,
      modelId: LOCAL_RERANK_MODEL_MINILM,
    });
  }
}

function scoresToMap(scores: number[]): Map<number, number> {
  const map = new Map<number, number>();
  scores.forEach((score, index) => {
    if (Number.isFinite(score)) {
      map.set(index, Math.min(1, Math.max(0, score)));
    }
  });
  return map;
}
