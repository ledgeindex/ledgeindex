import type { KapaRetrievedChunk } from "./kapa-retrieve.js";
import type { AnswerMode, CoverageTier } from "./assess-coverage.js";
import type { RetrievalStrictness } from "./retrieval-strictness.js";

export const LEDGEINDEX_RETRIEVAL_META_KEY = "ledgeindex_retrieval_meta";

export type RetrievalMetaChunk = {
  text: string;
  url: string;
  title: string;
  score: number;
  category: string;
  section: string;
  /** `expanded` chunks were pulled in as page context; their score is a placeholder. */
  retrievalKind?: "direct" | "expanded";
};

/** Knowledge sources selected for this answer (Explore multi-source / docs active set). */
export type RetrievalPickedSource = {
  id: string;
  slug: string;
  name: string;
  faviconUrl?: string | null;
  startUrl?: string | null;
  /** personal = local owner corpus; global = platform corpus */
  scope?: "personal" | "global";
  /** true when retrieved via LEDGEINDEX_REMOTE_API_URL */
  remote?: boolean;
  /** "code" for an indexed repository, "docs" for a crawled site. */
  kind?: "code" | "docs";
};

export type RetrievalSearchFilter = {
  url?: string;
  category?: string;
  section?: string;
  crawlRoot?: string;
  urlPrefix?: string;
};

export type RetrievalSearchAttempt = {
  query: string;
  /** Exact hybrid-search queries fused into this retrieval attempt. */
  queryVariants?: string[];
  /** Source this query was executed against (Explore multi-source). */
  sourceId?: string;
  sourceSlug?: string;
  sourceName?: string;
  chunkCount: number;
  insufficient: boolean;
  attemptType?: "query" | "catalog_url_fallback";
  filter?: RetrievalSearchFilter;
  catalogMatchScore?: number;
  initialCount?: number;
  rerankedCount?: number;
  directHitCount?: number;
  /** Rerank scores of direct hits (≥ threshold), highest first. */
  directHitScores?: number[];
  /** Top rerank scores when nothing passed the threshold. */
  rerankTopScores?: number[];
  prunedCount?: number;
};

export type RetrievalSourceRewrite = {
  sourceId: string;
  sourceSlug: string;
  sourceName: string;
  queries: string[];
  catalogQueries?: string[];
};

/** One timed stage in the RAG pipeline (shown in Retrieved sources). */
export type RetrievalTimingStep = {
  id: string;
  label: string;
  /** Duration in milliseconds (wall clock for sequential stages). */
  ms: number;
  /** Optional note, e.g. "sum across 2 queries" or model id. */
  detail?: string;
};

export type RetrievalTimings = {
  /** Full RAG processor wall time (catalog → coverage). */
  totalMs: number;
  steps: RetrievalTimingStep[];
};

export type RetrievalMeta = {
  question: string;
  rewrittenQueries: string[];
  /** Catalog page titles appended after LLM rewrite variants. */
  catalogQueries?: string[];
  /** Short natural-language question used for cross-encoder reranking. */
  intentForRerank?: string;
  /** Final cross-encoder query (intent + trimmed error/code snippet). */
  rerankQuery?: string;
  rewriteMethod: "llm" | "catalog" | "fallback" | "cascade";
  rewriteModelId?: string;
  /** single = one topic area. multi = distinct areas — all queries searched and merged. */
  topicScope?: "single" | "multi";
  skippedQueries?: string[];
  insufficient: boolean;
  partial: boolean;
  /** Highest chunk score across all injected chunks. */
  maxChunkScore?: number;
  /** Average of top 3 injected chunk scores. */
  avgTop3Score?: number;
  catalogUrlFilter?: {
    url: string;
    score: number;
    title: string;
    applied: boolean;
    succeeded: boolean;
  };
  relaxedPassUsed?: boolean;
  /** True when below-threshold rerank hits were shown to the answer agent. */
  weakEvidenceUsed?: boolean;
  /** Retrieval strictness used for this turn (strict / balanced / permissive). */
  retrievalStrictness?: RetrievalStrictness;
  /** Primary relevance threshold for the strict retrieve pass. */
  relevanceThreshold?: number;
  /** Relaxed threshold used on retry (balanced strictness). */
  relaxedThreshold?: number;
  cascadePassUsed?: boolean;
  /** Top raw vector score that triggered the cascade early-exit. */
  cascadeTopScore?: number;
  /** Active rerank backend id (cohere / local-auto / vector / …). */
  rerankBackend?: string;
  /**
   * Device that actually ran local CE scoring (`dml` / `cuda` / `cpu`),
   * or null for cloud/vector/cascade.
   */
  rerankDevice?: string | null;
  /** Short UI label, e.g. "GPU (DirectML)", "CPU", "Cohere". */
  rerankDeviceLabel?: string;
  answerMode?: AnswerMode;
  coverageTier?: CoverageTier;
  coverageGraderUsed?: boolean;
  coverageReason?: string;
  coverageModelId?: string;
  /** Sources the processor picked for this turn (badges above chat input). */
  pickedSources?: RetrievalPickedSource[];
  /** Rewrite and catalogue candidates generated independently per source. */
  sourceRewrites?: RetrievalSourceRewrite[];
  searchAttempts: RetrievalSearchAttempt[];
  chunks: RetrievalMetaChunk[];
  /** Pages retrieved then dropped before the answer agent saw them. */
  droppedPages?: Array<{ url: string; title: string; reason: string }>;
  /** True when the page keep/drop filter ran. */
  pageFilterUsed?: boolean;
  /** Per-step latency for Retrieved sources (expandable timing). */
  timings?: RetrievalTimings;
  /** @deprecated use rewrittenQueries */
  queries?: string[];
};

export function toRetrievalMetaChunk(
  chunk: KapaRetrievedChunk,
): RetrievalMetaChunk {
  return {
    text: chunk.text,
    url: chunk.url,
    title: chunk.title,
    score: chunk.score,
    category: chunk.category,
    section: chunk.section,
    retrievalKind: chunk.retrievalKind,
  };
}

export function readRetrievalMeta(
  requestContext: { get?: (key: string) => unknown } | undefined,
): RetrievalMeta | undefined {
  if (!requestContext?.get) return undefined;
  const value = requestContext.get(LEDGEINDEX_RETRIEVAL_META_KEY);
  if (!value || typeof value !== "object") return undefined;
  return value as RetrievalMeta;
}
