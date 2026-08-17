export type RetrievalStrictness = "strict" | "balanced" | "permissive";

export const RETRIEVAL_STRICTNESS_STORAGE_KEY =
  "ledgeindex.retrievalStrictness";

export const DEFAULT_CHAT_RETRIEVAL_STRICTNESS: RetrievalStrictness = "strict";

export const RETRIEVAL_STRICTNESS_OPTIONS: Array<{
  value: RetrievalStrictness;
  label: string;
  description: string;
}> = [
  {
    value: "strict",
    label: "Strict",
    description: "Only high-confidence matches (default)",
  },
  {
    value: "balanced",
    label: "Balanced",
    description: "Retry at 0.50 when nothing passes strict (0.65)",
  },
  {
    value: "permissive",
    label: "Permissive",
    description: "0.50 threshold plus weak matches below that",
  },
];

export function isRetrievalStrictness(
  value: string | null | undefined,
): value is RetrievalStrictness {
  return value === "strict" || value === "balanced" || value === "permissive";
}

export function readStoredRetrievalStrictness(): RetrievalStrictness {
  if (typeof window === "undefined") return DEFAULT_CHAT_RETRIEVAL_STRICTNESS;
  const stored = window.localStorage.getItem(RETRIEVAL_STRICTNESS_STORAGE_KEY);
  return isRetrievalStrictness(stored)
    ? stored
    : DEFAULT_CHAT_RETRIEVAL_STRICTNESS;
}

export function storeRetrievalStrictness(value: RetrievalStrictness): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(RETRIEVAL_STRICTNESS_STORAGE_KEY, value);
}

export function resetRetrievalStrictness(): RetrievalStrictness {
  storeRetrievalStrictness(DEFAULT_CHAT_RETRIEVAL_STRICTNESS);
  return DEFAULT_CHAT_RETRIEVAL_STRICTNESS;
}

export function retrievalStrictnessIncludesWeakEvidence(
  strictness: RetrievalStrictness,
): boolean {
  return strictness === "permissive";
}
