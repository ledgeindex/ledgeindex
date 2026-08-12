export type RetrievalMetaChunk = {
  text: string;
  url: string;
  title: string;
  score: number;
  category: string;
  section: string;
};

export type RetrievalPickedSource = {
  id: string;
  slug: string;
  name: string;
  faviconUrl?: string | null;
  startUrl?: string | null;
  /** personal = local owner corpus; global = platform corpus */
  scope?: "personal" | "global";
  /** true when retrieved via remote platform API */
  remote?: boolean;
};

export type RetrievalSearchFilter = {
  url?: string;
  category?: string;
  section?: string;
};

export type RetrievalSearchAttempt = {
  query: string;
  chunkCount: number;
  insufficient: boolean;
  attemptType?: "query" | "catalog_url_fallback";
  filter?: RetrievalSearchFilter;
  catalogMatchScore?: number;
  initialCount?: number;
  rerankedCount?: number;
  directHitCount?: number;
  directHitScores?: number[];
  prunedCount?: number;
};

export type RetrievalTimingStep = {
  id: string;
  label: string;
  ms: number;
  detail?: string;
};

export type RetrievalTimings = {
  totalMs: number;
  steps: RetrievalTimingStep[];
};

export type AnswerMode = "full" | "partial" | "none";
export type CoverageTier = "tier0" | "tier1_heuristic" | "tier2_llm";

export type RetrievalMeta = {
  question: string;
  rewrittenQueries: string[];
  rewriteMethod?: "llm" | "catalog" | "fallback" | "cascade";
  rewriteModelId?: string;
  topicScope?: "single" | "multi";
  skippedQueries?: string[];
  insufficient: boolean;
  partial: boolean;
  maxChunkScore?: number;
  avgTop3Score?: number;
  catalogUrlFilter?: {
    url: string;
    score: number;
    title: string;
    applied: boolean;
    succeeded: boolean;
  };
  relaxedPassUsed?: boolean;
  /** Cheap vector early-exit skipped rewrite + rerank. */
  cascadePassUsed?: boolean;
  cascadeTopScore?: number;
  rerankBackend?: string;
  rerankDevice?: string | null;
  rerankDeviceLabel?: string;
  answerMode?: AnswerMode;
  coverageTier?: CoverageTier;
  coverageGraderUsed?: boolean;
  coverageReason?: string;
  coverageModelId?: string;
  /** Sources picked for this answer (shown as input attachment badges). */
  pickedSources?: RetrievalPickedSource[];
  searchAttempts: RetrievalSearchAttempt[];
  chunks: RetrievalMetaChunk[];
  /** Per-step latency (expandable on Retrieved sources). */
  timings?: RetrievalTimings;
  /** @deprecated use rewrittenQueries */
  queries?: string[];
};

export type CoverageLevel = "high" | "partial" | "none";

/** Aligns with planned coverage tiers (strict 0.65, full ≥0.82 max + ≥0.75 avgTop3). */
export const COVERAGE_THRESHOLDS = {
  strict: 0.65,
  relaxed: 0.5,
  fullMaxScore: 0.82,
  fullAvgTop3: 0.75,
} as const;

export function assessCoverageLevel(meta: {
  answerMode?: AnswerMode;
  insufficient?: boolean;
  partial?: boolean;
  maxChunkScore?: number;
  avgTop3Score?: number;
  chunks?: unknown[];
}): CoverageLevel {
  if (meta.answerMode === "full") return "high";
  if (meta.answerMode === "partial") return "partial";
  if (meta.answerMode === "none") return "none";

  if (meta.insufficient || (meta.chunks?.length ?? 0) === 0) return "none";
  if (meta.partial) return "partial";

  const max = meta.maxChunkScore ?? 0;
  const avg = meta.avgTop3Score ?? 0;

  if (max >= COVERAGE_THRESHOLDS.fullMaxScore && avg >= COVERAGE_THRESHOLDS.fullAvgTop3) {
    return "high";
  }

  return "partial";
}

export function assessHitCoverageLevel(input: {
  directHitScores?: number[];
  insufficient?: boolean;
}): CoverageLevel {
  const scores = input.directHitScores ?? [];
  if (input.insufficient || scores.length === 0) return "none";

  const max = scores[0];
  if (max < COVERAGE_THRESHOLDS.strict) return "none";

  const top3 = scores.slice(0, 3);
  const avgTop3 = top3.reduce((sum, score) => sum + score, 0) / top3.length;

  if (
    max >= COVERAGE_THRESHOLDS.fullMaxScore &&
    avgTop3 >= COVERAGE_THRESHOLDS.fullAvgTop3
  ) {
    return "high";
  }

  return "partial";
}

export function readRewrittenQueries(meta: RetrievalMeta): string[] {
  if (meta.rewrittenQueries?.length) return meta.rewrittenQueries;
  if (meta.queries?.length) return meta.queries;
  return [];
}

export function readRetrievalFromParts(
  parts: Array<{ type: string; data?: unknown }>,
): RetrievalMeta | null {
  for (const part of parts) {
    if (part.type !== "data-retrieval") continue;
    if (!part.data || typeof part.data !== "object") continue;
    return part.data as RetrievalMeta;
  }
  return null;
}
