import { askSource } from "@ledgeindex/docs/runtime/services/source-ask.js";
import { assertChatModelAvailable } from "./resolve-options.js";
import { getActiveOptions } from "./runtime.js";
import { resolveSourceRef } from "./sources.js";
import type { LedgeIndexAskOptions } from "./types.js";

export async function askQuestion(
  sourceIdOrSlug: string,
  question: string,
  options: LedgeIndexAskOptions = {},
) {
  const resolved = getActiveOptions();
  if (options.mode !== "retrieve-only") {
    assertChatModelAvailable(resolved, "ask");
  }
  const { sourceId } = await resolveSourceRef(sourceIdOrSlug);
  /**
   * Only forward a backend somebody actually chose. Passing a computed default
   * counts as an explicit request downstream, which blocks the code-source
   * override that skips the prose cross-encoder on repo indexes.
   */
  const rerankBackend = options.rerankBackend ?? resolved.rerankBackend;

  return askSource(sourceId, question, {
    ...(rerankBackend ? { rerankBackend } : {}),
    ...(options.mode ? { mode: options.mode } : {}),
    ...(options.retrievalStrictness
      ? { retrievalStrictness: options.retrievalStrictness }
      : {}),
    ...(options.relevanceThreshold !== undefined
      ? { relevanceThreshold: options.relevanceThreshold }
      : {}),
    ...(typeof options.includeWeakEvidence === "boolean"
      ? { includeWeakEvidence: options.includeWeakEvidence }
      : {}),
  });
}
