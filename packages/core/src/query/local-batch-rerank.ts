import type { QueryResult } from "@mastra/core/vector";
import type { RerankResult } from "@mastra/rag";
import { logVerbose, logWarn } from "../lib/logger.js";
import { SEARCH_TOP_K } from "../vector/constants.js";
import {
  getLocalRerankModelId,
  preferInProcessLocalRerank,
  scoreDocumentsInProcess,
} from "./local-bge-inprocess.js";
import { combineWeightedRerankScores } from "./weighted-rerank.js";

export function getLocalRerankUrl(): string {
  return (
    process.env.LEDGEINDEX_LOCAL_RERANK_URL?.trim() ||
    "http://127.0.0.1:8080/rerank"
  );
}

type LocalRerankResponse = {
  scores?: number[];
  results?: Array<{ index?: number; score?: number }>;
};

function scoresToSemanticMap(
  resultsLength: number,
  scores: number[],
): Map<number, number> {
  const semanticByIndex = new Map<number, number>();
  scores.forEach((score, index) => {
    if (index < resultsLength && Number.isFinite(score)) {
      semanticByIndex.set(index, Math.min(1, Math.max(0, score)));
    }
  });
  return semanticByIndex;
}

async function localSidecarBatchRerank(input: {
  query: string;
  results: QueryResult[];
  topK: number;
  url: string;
}): Promise<RerankResult[]> {
  const { query, results, topK, url } = input;
  const documents = results.map((result) =>
    String(result.metadata?.text ?? "").slice(0, 4000),
  );

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, documents }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Local rerank error: ${response.status} ${body}`);
  }

  const data = (await response.json()) as LocalRerankResponse;
  const semanticByIndex = new Map<number, number>();

  if (Array.isArray(data.scores)) {
    for (const [index, score] of scoresToSemanticMap(
      results.length,
      data.scores,
    )) {
      semanticByIndex.set(index, score);
    }
  }

  for (const entry of data.results ?? []) {
    const index = Number(entry.index);
    const score = Number(entry.score);
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
    throw new Error("Local rerank returned no scores");
  }

  logVerbose("Local sidecar batch rerank complete", "LocalRerank", {
    url,
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
 * Local BGE cross-encoder rerank.
 *
 * Default: in-process (`@huggingface/transformers`, Xenova/bge-reranker-base).
 * Optional fallback: HTTP sidecar (`LEDGEINDEX_LOCAL_RERANK_URL`, default :8080).
 * Force sidecar-only with `LEDGEINDEX_LOCAL_RERANK_MODE=sidecar`.
 */
export async function localBatchRerank(input: {
  query: string;
  results: QueryResult[];
  topK?: number;
  url?: string;
  /** Override in-process model (e.g. v2-m3). Sidecar still uses its own env model. */
  modelId?: string;
}): Promise<RerankResult[]> {
  const { query, results, topK = SEARCH_TOP_K } = input;
  if (results.length === 0) return [];

  const documents = results.map((result) =>
    String(result.metadata?.text ?? "").slice(0, 4000),
  );
  const url = input.url ?? getLocalRerankUrl();
  const preferInProcess = preferInProcessLocalRerank();
  const modelId = input.modelId ?? getLocalRerankModelId();

  if (preferInProcess) {
    try {
      const scores = await scoreDocumentsInProcess(query, documents, modelId);
      const semanticByIndex = scoresToSemanticMap(results.length, scores);
      if (semanticByIndex.size === 0) {
        throw new Error("In-process local rerank returned no scores");
      }
      logVerbose("Local in-process batch rerank complete", "LocalRerank", {
        documentCount: documents.length,
        scoredCount: semanticByIndex.size,
        modelId,
      });
      return combineWeightedRerankScores({
        results,
        semanticByIndex,
        topK,
      });
    } catch (error) {
      logWarn(
        error instanceof Error
          ? error.message
          : "In-process local rerank failed",
        "LocalRerank",
        { fallback: "sidecar", url, modelId },
      );
    }
  }

  return localSidecarBatchRerank({ query, results, topK, url });
}
