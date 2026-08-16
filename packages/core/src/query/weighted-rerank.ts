import type { QueryResult } from "@mastra/core/vector";
import type { RerankResult } from "@mastra/rag";
import { SEARCH_RERANK_WEIGHTS } from "../vector/constants.js";
import type { FusedQueryResult } from "./hybrid-fuse.js";

/**
 * The similarity the embedding reported, which after fusion is no longer in
 * `score` — that slot holds the fused rank weight. See `hybrid-fuse.ts`.
 */
function similarityOf(result: QueryResult): number {
  return (result as FusedQueryResult).denseScore ?? result.score ?? 0;
}

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
    const vectorScore = similarityOf(result);
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

/**
 * Ranking with no cross-encoder: the candidates arrive in fused order, and that
 * order is kept.
 *
 * The score cannot simply be the incoming `score`, because after fusion that is
 * a rank weight of about 0.03 while `RELEVANCE_THRESHOLD` expects a relevance
 * value near 0.65 — every result would be pruned and the source would refuse to
 * answer. Nor can it be the raw cosine, since three consumers (the pruner,
 * coverage assessment, and every downstream sort) assume the score decreases
 * with rank, and cosine does not once the lexical leg reorders the pool.
 *
 * So it is the same weighted blend the cross-encoder path uses, with the
 * semantic term dropped and the remaining two weights renormalized: relevance
 * from the embedding, ordering from the fusion.
 */
export function vectorOnlyRerank(
  results: QueryResult[],
  topK: number,
): RerankResult[] {
  const { vector, position } = SEARCH_RERANK_WEIGHTS;
  const total = vector + position;
  const vectorWeight = vector / total;
  const positionWeight = position / total;
  const resultLength = Math.max(results.length, 1);

  return results.slice(0, topK).map((result, index) => {
    const vectorScore = similarityOf(result);
    const positionScore = calculatePositionScore(index, resultLength);

    return {
      result,
      score: vectorWeight * vectorScore + positionWeight * positionScore,
      details: {
        semantic: 0,
        vector: vectorScore,
        position: positionScore,
      },
    } satisfies RerankResult;
  });
}
