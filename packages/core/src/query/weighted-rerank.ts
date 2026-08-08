import type { QueryResult } from "@mastra/core/vector";
import type { RerankResult } from "@mastra/rag";
import { SEARCH_RERANK_WEIGHTS } from "../vector/constants.js";

export function calculatePositionScore(
  position: number,
  totalChunks: number,
): number {
  return 1 - position / totalChunks;
}

export function combineWeightedRerankScores(input: {
  results: QueryResult[];
  semanticByIndex: Map<number, number>;
  topK: number;
}): RerankResult[] {
  const weights = { ...SEARCH_RERANK_WEIGHTS };
  const resultLength = input.results.length;

  const scored = input.results.map((result, index) => {
    const semanticScore = input.semanticByIndex.get(index) ?? 0;
    const vectorScore = result.score ?? 0;
    const positionScore = calculatePositionScore(index, resultLength);
    const score =
      weights.semantic * semanticScore +
      weights.vector * vectorScore +
      weights.position * positionScore;

    return {
      result,
      score,
      details: {
        semantic: semanticScore,
        vector: vectorScore,
        position: positionScore,
      },
    } satisfies RerankResult;
  });

  return scored.sort((a, b) => b.score - a.score).slice(0, input.topK);
}

export function vectorOnlyRerank(
  results: QueryResult[],
  topK: number,
): RerankResult[] {
  return results.slice(0, topK).map((result, index) => ({
    result,
    score: result.score ?? 1 - index * 0.01,
    details: {
      semantic: 0,
      vector: result.score ?? 0,
      position: 1 - index / Math.max(results.length, 1),
    },
  }));
}
