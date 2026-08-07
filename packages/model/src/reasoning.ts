import type { ReasoningEffort } from "./types.js";

/** Maps an OpenAI-style `reasoning_effort` value to a node-llama-cpp `budgets.thoughtTokens` budget. */
export const REASONING_EFFORT_THOUGHT_TOKENS: Record<ReasoningEffort, number> = {
  off: 0,
  low: 250,
  medium: 1000,
  high: 4000,
};

export function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return typeof value === "string" && value in REASONING_EFFORT_THOUGHT_TOKENS;
}

/** Normalize OpenAI / LM Studio / AI SDK effort labels onto our enum. */
export function normalizeReasoningEffort(value: unknown): ReasoningEffort | undefined {
  if (value === "none" || value === "off" || value === "minimal") return "off";
  if (isReasoningEffort(value)) return value;
  if (value === "xhigh" || value === "max") return "high";
  return undefined;
}

export function reasoningEffortToThoughtTokens(effort: ReasoningEffort | undefined, fallback = 0): number {
  if (!effort) return fallback;
  return REASONING_EFFORT_THOUGHT_TOKENS[effort] ?? fallback;
}

/**
 * Resolve a `budgets.thoughtTokens` value from either an explicit token count or a
 * `reasoning_effort`-style label. An explicit `thoughtTokens` always wins.
 */
export function thoughtTokensFromRequest(options: {
  thoughtTokens?: number;
  reasoningEffort?: ReasoningEffort | string | null;
  /** When effort is omitted, use this fallback (Gemma chat UI defaults to medium). */
  defaultEffort?: ReasoningEffort;
}): number {
  if (typeof options.thoughtTokens === "number" && Number.isFinite(options.thoughtTokens)) {
    return Math.max(0, options.thoughtTokens);
  }
  const effort = normalizeReasoningEffort(options.reasoningEffort) ?? options.defaultEffort;
  if (effort) return reasoningEffortToThoughtTokens(effort);
  return 0;
}
