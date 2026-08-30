import type { QueryResult } from "@mastra/core/vector";
import { RRF_K } from "../vector/constants.js";
import type { LexicalHit } from "./lexical-store.js";

/**
 * Reciprocal rank fusion of the dense and lexical legs.
 *
 * Cosine similarity and BM25 are not on a comparable scale, so their scores
 * cannot be sorted together. RRF uses only each leg's ordering, which makes it
 * scale-free: a chunk ranked first by keyword match and absent from the dense
 * list still enters the candidate pool.
 *
 * Fusion decides which candidates reach the cross-encoder; the final ordering
 * is still the reranker's.
 */

/**
 * A fused candidate carries two different numbers, and conflating them is a bug
 * that hides well: `score` is the fused rank weight, which orders the candidate
 * pool and is on no meaningful scale, while `denseScore` is the cosine
 * similarity the embedding actually reported.
 *
 * The rerankers need the second one. `combineWeightedRerankScores` feeds it in
 * as a relevance feature at 30% weight, and `RELEVANCE_THRESHOLD` is calibrated
 * against the resulting scale — so overwriting the cosine with a ~0.03 rank
 * weight quietly costs every score about 0.2 and makes sources refuse to answer
 * questions they retrieved correctly.
 */
export type FusedQueryResult = QueryResult & { denseScore?: number };

export type FusedCandidates = {
  results: FusedQueryResult[];
  denseCount: number;
  lexicalCount: number;
  /** Candidates the lexical leg contributed that dense retrieval missed. */
  lexicalOnlyCount: number;
};

function rrfWeight(rank: number): number {
  return 1 / (RRF_K + rank + 1);
}

/**
 * LlamaIndex-style reciprocal rank fusion across multiple ordered lists.
 * Uses rank position only — safe when lists come from different queries or paths.
 */
export function fuseRankedListsByRrf<T>(input: {
  lists: T[][];
  id: (item: T) => string;
  limit: number;
  /** When the same id appears in multiple lists, keep the item with the higher score. */
  score?: (item: T) => number;
}): T[] {
  const fused = new Map<string, { item: T; rrf: number }>();

  for (const list of input.lists) {
    for (const [rank, item] of list.entries()) {
      const id = input.id(item);
      if (!id) continue;
      const weight = rrfWeight(rank);
      const existing = fused.get(id);
      if (existing) {
        existing.rrf += weight;
        if (
          input.score &&
          input.score(item) > input.score(existing.item)
        ) {
          existing.item = item;
        }
        continue;
      }
      fused.set(id, { item, rrf: weight });
    }
  }

  return [...fused.values()]
    .sort((a, b) => b.rrf - a.rrf)
    .slice(0, input.limit)
    .map((entry) => entry.item);
}

export function fuseDenseAndLexical(input: {
  dense: QueryResult[];
  lexical: LexicalHit[];
  limit: number;
}): FusedCandidates {
  const { dense, lexical, limit } = input;

  if (lexical.length === 0) {
    return {
      results: dense
        .slice(0, limit)
        .map((result) => ({ ...result, denseScore: result.score ?? 0 })),
      denseCount: dense.length,
      lexicalCount: 0,
      lexicalOnlyCount: 0,
    };
  }

  const fused = new Map<
    string,
    { result: QueryResult; score: number; denseScore: number }
  >();

  for (const [rank, result] of dense.entries()) {
    const id = String(result.id ?? "");
    if (!id) continue;
    fused.set(id, {
      result,
      score: rrfWeight(rank),
      denseScore: result.score ?? 0,
    });
  }

  /**
   * A lexical-only candidate has no cosine, because it placed outside the dense
   * leg's top-k — which is itself the bound: its true similarity is at most that
   * of the weakest dense candidate. Standing in that bound keeps keyword hits
   * competitive on the relevance feature instead of zeroing them, without
   * claiming a similarity the embedding never reported.
   */
  const weakestDense = dense.length
    ? Math.min(...dense.map((result) => result.score ?? 0))
    : 0;

  let lexicalOnlyCount = 0;
  for (const [rank, hit] of lexical.entries()) {
    if (!hit.id) continue;
    const existing = fused.get(hit.id);
    if (existing) {
      existing.score += rrfWeight(rank);
      continue;
    }
    lexicalOnlyCount += 1;
    fused.set(hit.id, {
      result: { id: hit.id, score: 0, metadata: hit.metadata } as QueryResult,
      score: rrfWeight(rank),
      denseScore: weakestDense,
    });
  }

  const ordered = [...fused.values()].sort((a, b) => b.score - a.score);

  return {
    // `score` becomes the fused rank weight so the ordering is the hybrid one
    // rather than a mix of two scales; the cosine rides along in `denseScore`
    // for whoever needs a relevance number rather than a rank.
    results: ordered.slice(0, limit).map((entry) => ({
      ...entry.result,
      score: entry.score,
      denseScore: entry.denseScore,
    })),
    denseCount: dense.length,
    lexicalCount: lexical.length,
    lexicalOnlyCount,
  };
}

/** RRF merge across multiple hybrid candidate pools (query variants or dual paths). */
export function mergeFusedCandidatePoolsMany(
  pools: FusedQueryResult[][],
  limit: number,
): FusedQueryResult[] {
  const lists = pools.filter((pool) => pool.length > 0);
  if (lists.length === 0) return [];
  if (lists.length === 1) return lists[0].slice(0, limit);

  const fused = new Map<string, { result: FusedQueryResult; rrf: number }>();

  for (const list of lists) {
    for (const [rank, result] of list.entries()) {
      const id = String(result.id ?? "");
      if (!id) continue;
      const weight = rrfWeight(rank);
      const existing = fused.get(id);
      if (existing) {
        existing.rrf += weight;
        existing.result.denseScore = Math.max(
          existing.result.denseScore ?? 0,
          result.denseScore ?? 0,
        );
        continue;
      }
      fused.set(id, { result: { ...result }, rrf: weight });
    }
  }

  return [...fused.values()]
    .sort((left, right) => right.rrf - left.rrf)
    .slice(0, limit)
    .map((entry) => ({
      ...entry.result,
      score: entry.rrf,
      denseScore: entry.result.denseScore,
    }));
}

/**
 * RRF across query variants rewards pages that match every phrasing. A catalog
 * title that only wins its own list can fall out of a 20-slot pool. Keep each
 * query's top hit so the cross-encoder still sees it; the reranker, not fusion,
 * decides whether it survives the threshold.
 */
export function ensurePerQueryWinners(
  pools: FusedQueryResult[][],
  merged: FusedQueryResult[],
  limit: number,
): FusedQueryResult[] {
  const idOf = (result: FusedQueryResult) => String(result.id ?? "");
  const seen = new Set(merged.map(idOf).filter(Boolean));
  const missing: FusedQueryResult[] = [];
  for (const pool of pools) {
    const winner = pool[0];
    if (!winner) continue;
    const id = idOf(winner);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    missing.push(winner);
  }
  if (missing.length === 0) return merged.slice(0, limit);
  const keep = Math.max(0, limit - missing.length);
  return [...merged.slice(0, keep), ...missing];
}

/**
 * Add a recovered catalog page's best chunks without displacing fusion's own
 * candidates. RRF-merging the two pools instead makes them rivals for a fixed
 * budget, so recovering one page silently drops another.
 */
export function appendCatalogCandidates(
  base: FusedQueryResult[],
  catalog: FusedQueryResult[],
  limit: number,
): FusedQueryResult[] {
  if (limit <= 0 || catalog.length === 0) return base;
  const seen = new Set(base.map((result) => String(result.id ?? "")));
  const added: FusedQueryResult[] = [];
  for (const result of catalog) {
    if (added.length >= limit) break;
    const id = String(result.id ?? "");
    if (!id || seen.has(id)) continue;
    seen.add(id);
    added.push(result);
  }
  return added.length === 0 ? base : [...base, ...added];
}

/** Dual-path merge: RRF across Path A and Path B (LlamaIndex fusion pattern). */
export function mergeFusedCandidatePools(
  a: FusedQueryResult[],
  b: FusedQueryResult[],
  limit: number,
): FusedQueryResult[] {
  return mergeFusedCandidatePoolsMany([a, b], limit);
}
