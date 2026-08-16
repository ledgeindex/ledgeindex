import { askRouted } from "@ledgeindex/docs/runtime/services/routed-ask.js";
import { assertChatModelAvailable } from "./resolve-options.js";
import { getActiveOptions, getLocalUserId } from "./runtime.js";
import { resolveSourceRef } from "./sources.js";
import type { LedgeIndexAskAcrossOptions } from "./types.js";

export async function askAcrossSources(
  question: string,
  options: LedgeIndexAskAcrossOptions = {},
) {
  const resolved = getActiveOptions();
  assertChatModelAvailable(resolved, "askAcross");

  // Accept ids or slugs like ask() does; the picker matches on slug.
  const slugs = await Promise.all(
    (options.sources ?? []).map(async (ref) => {
      const { slug } = await resolveSourceRef(ref);
      return slug;
    }),
  );

  const rerankBackend = options.rerankBackend ?? resolved.rerankBackend;

  return askRouted(question, {
    userId: getLocalUserId(),
    ...(slugs.length > 0 ? { sources: slugs } : {}),
    ...(options.sourceSet ? { sourceSet: options.sourceSet } : {}),
    ...(options.sourceMode ? { sourceMode: options.sourceMode } : {}),
    ...(rerankBackend ? { rerankBackend } : {}),
  });
}
