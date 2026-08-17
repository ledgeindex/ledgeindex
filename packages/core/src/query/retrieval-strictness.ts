import {
  RELEVANCE_THRESHOLD,
  RELAXED_RELEVANCE_THRESHOLD,
  WEAK_EVIDENCE_MIN_SCORE,
  WEAK_EVIDENCE_TOP_K,
} from "../vector/constants.js";

/** How aggressively retrieval prunes before the answer agent runs. */
export type RetrievalStrictness = "strict" | "balanced" | "permissive";

export const DEFAULT_RETRIEVAL_STRICTNESS: RetrievalStrictness = "strict";

export { WEAK_EVIDENCE_MIN_SCORE, WEAK_EVIDENCE_TOP_K };

export type ResolvedRetrievalSettings = {
  strictness: RetrievalStrictness;
  relevanceThreshold: number;
  relaxedThreshold: number;
  includeWeakEvidence: boolean;
};

export function isRetrievalStrictness(value: unknown): value is RetrievalStrictness {
  return value === "strict" || value === "balanced" || value === "permissive";
}

export function resolveRetrievalSettings(input?: {
  strictness?: RetrievalStrictness;
  relevanceThreshold?: number | null;
  includeWeakEvidence?: boolean;
}): ResolvedRetrievalSettings {
  const strictness = input?.strictness ?? DEFAULT_RETRIEVAL_STRICTNESS;

  let relevanceThreshold = RELEVANCE_THRESHOLD;
  let relaxedThreshold = RELAXED_RELEVANCE_THRESHOLD;
  let includeWeakEvidence = false;

  if (strictness === "permissive") {
    relevanceThreshold = RELAXED_RELEVANCE_THRESHOLD;
    relaxedThreshold = RELAXED_RELEVANCE_THRESHOLD;
    includeWeakEvidence = true;
  }

  if (typeof input?.relevanceThreshold === "number" && Number.isFinite(input.relevanceThreshold)) {
    const clamped = Math.max(0, Math.min(1, input.relevanceThreshold));
    relevanceThreshold = clamped;
    relaxedThreshold = Math.min(relaxedThreshold, clamped);
  } else if (input?.relevanceThreshold === null) {
    relevanceThreshold = 0;
    relaxedThreshold = 0;
  }

  if (typeof input?.includeWeakEvidence === "boolean") {
    includeWeakEvidence = input.includeWeakEvidence;
  }

  return {
    strictness,
    relevanceThreshold,
    relaxedThreshold,
    includeWeakEvidence,
  };
}
