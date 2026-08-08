import type { QueryResult } from "@mastra/core/vector";
import type { ExampleKind } from "../enrich/schemas.js";
import type { ApiResponseMeta } from "../enrich/api-response-meta.js";
import { apiResponseMetaFromChunkMetadata } from "../enrich/api-response-meta.js";
import { logVerbose } from "../lib/logger.js";
import {
  LEDGEINDEX_CHUNKS_INDEX,
  RELEVANCE_THRESHOLD,
  RELAXED_RELEVANCE_THRESHOLD,
  SEARCH_TOP_K,
} from "../vector/constants.js";
import { embedQuery } from "../vector/embedding.js";
import { ensureChunksIndex, getVectorStore } from "../vector/store.js";
import {
  executeKapaRerank,
  getSearchRerankCandidates,
} from "./rerank-backend.js";
import { readExampleLanguageFromMetadata } from "./page-examples.js";

export type QueryExamplesHit = {
  id: string;
  score: number;
  title: string;
  kind: ExampleKind | string;
  language: string | null;
  body: string;
  embedText: string;
  url: string;
  section: string;
  exampleIndex: number;
  examplePartIndex?: number;
  pageSummary: string;
  apiResponse?: ApiResponseMeta | null;
};

export type QueryExamplesInput = {
  query: string;
  sourceId: string;
  exampleKind?: ExampleKind | ExampleKind[];
  language?: string;
  topK?: number;
  /** Wide vector pull before rerank (default from getSearchRerankCandidates). */
  candidateCount?: number;
  relevanceThreshold?: number;
  /** When strict threshold yields nothing, retry prune at RELAXED. */
  allowRelaxed?: boolean;
};

export type QueryExamplesResult = {
  query: string;
  hits: QueryExamplesHit[];
  initialCount: number;
  rerankedCount: number;
  directHitCount: number;
  directHitScores: number[];
  insufficient: boolean;
  relaxedPassUsed: boolean;
};

function toHit(result: QueryResult, score: number): QueryExamplesHit {
  const metadata = (result.metadata ?? {}) as Record<string, unknown>;
  const apiResponse = apiResponseMetaFromChunkMetadata(metadata);
  return {
    id: String(result.id ?? ""),
    score,
    title: String(metadata.exampleTitle ?? metadata.title ?? ""),
    kind: String(metadata.exampleKind ?? "other"),
    language: readExampleLanguageFromMetadata(metadata),
    body: String(metadata.body ?? metadata.fullBody ?? ""),
    embedText: String(metadata.text ?? ""),
    url: String(metadata.url ?? metadata.parentUrl ?? ""),
    section: String(metadata.section ?? ""),
    exampleIndex: Number(metadata.exampleIndex ?? 0),
    ...(metadata.examplePartIndex != null
      ? { examplePartIndex: Number(metadata.examplePartIndex) }
      : {}),
    pageSummary: String(metadata.pageSummary ?? ""),
    ...(apiResponse ? { apiResponse } : {}),
  };
}

function matchesKindFilter(
  metadata: Record<string, unknown>,
  kinds: Set<ExampleKind> | null,
): boolean {
  if (String(metadata.chunkKind ?? "") !== "example") return false;
  if (!kinds) return true;
  const kind = String(metadata.exampleKind ?? "other");
  return kinds.has(kind as ExampleKind);
}

/**
 * Example-only retrieval: filter → wide vector → rerank → relevance threshold.
 * Same stages as kapaRetrieve, scoped to chunkKind=example (no page expansion).
 */
export async function queryExamples(
  input: QueryExamplesInput,
): Promise<QueryExamplesResult> {
  await ensureChunksIndex();

  const store = getVectorStore();
  const queryVector = await embedQuery(input.query);
  const topK = input.topK ?? SEARCH_TOP_K;
  const candidateCount = input.candidateCount ?? getSearchRerankCandidates();
  const threshold = input.relevanceThreshold ?? RELEVANCE_THRESHOLD;
  const allowRelaxed = input.allowRelaxed !== false;

  const filter: Record<string, string> = {
    sourceId: input.sourceId,
    chunkKind: "example",
  };

  if (typeof input.exampleKind === "string") {
    filter.exampleKind = input.exampleKind;
  }
  if (input.language?.trim()) {
    filter.language = input.language.trim().toLowerCase();
  }

  const kinds = Array.isArray(input.exampleKind)
    ? new Set(input.exampleKind)
    : null;

  const initialResults = await store.query({
    indexName: LEDGEINDEX_CHUNKS_INDEX,
    queryVector,
    topK: candidateCount,
    filter,
  });

  const candidates = initialResults.filter((result) =>
    matchesKindFilter(
      (result.metadata ?? {}) as Record<string, unknown>,
      kinds,
    ),
  );

  logVerbose("Examples retrieve: initial vector search", "QueryExamples", {
    sourceId: input.sourceId,
    initialCount: candidates.length,
    filter,
    candidateCount,
  });

  const reranked = await executeKapaRerank({
    query: input.query,
    results: candidates,
    queryVector,
    topK,
  });

  let pruned = reranked.filter((entry) => entry.score >= threshold);
  let relaxedPassUsed = false;

  if (pruned.length === 0 && allowRelaxed && threshold > RELAXED_RELEVANCE_THRESHOLD) {
    pruned = reranked.filter(
      (entry) => entry.score >= RELAXED_RELEVANCE_THRESHOLD,
    );
    relaxedPassUsed = pruned.length > 0;
  }

  const hits = pruned.map((entry) => toHit(entry.result, entry.score));
  const directHitScores = hits.map((hit) => hit.score).sort((a, b) => b - a);

  logVerbose("Examples retrieve: rerank + prune", "QueryExamples", {
    sourceId: input.sourceId,
    rerankedCount: reranked.length,
    directHitCount: hits.length,
    relaxedPassUsed,
    threshold,
  });

  return {
    query: input.query,
    hits,
    initialCount: candidates.length,
    rerankedCount: reranked.length,
    directHitCount: hits.length,
    directHitScores,
    insufficient: hits.length === 0,
    relaxedPassUsed,
  };
}
