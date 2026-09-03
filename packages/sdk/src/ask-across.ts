import { askRouted } from "@ledgeindex/docs/runtime/services/routed-ask.js";
import { assertChatModelAvailable } from "./resolve-options.js";
import { getActiveOptions, getLocalUserId } from "./runtime.js";
import { resolveSourceRef } from "./sources.js";
import type { LedgeIndexAskAcrossOptions } from "./types.js";

export async function askAcrossSources(
  question: string,
  options: LedgeIndexAskAcrossOptions = {}
) {
  const resolved = getActiveOptions();
  assertChatModelAvailable(resolved, "askAcross");

  // Resolve to exact ids so version-qualified targets cannot drift to another
  // member of the same source family.
  const sourceRefs = await Promise.all(
    (options.sources ?? []).map(async (target) => {
      const ref = typeof target === "string" ? target : target.source;
      const version = typeof target === "string" ? undefined : target.version;
      const { sourceId } = await resolveSourceRef(ref, { version });
      return sourceId;
    })
  );

  const rerankBackend = options.rerankBackend ?? resolved.rerankBackend;

  return askRouted(question, {
    userId: getLocalUserId(),
    ...(sourceRefs.length > 0 ? { sources: sourceRefs } : {}),
    ...(options.sourceSet ? { sourceSet: options.sourceSet } : {}),
    ...(options.sourceMode ? { sourceMode: options.sourceMode } : {}),
    ...(rerankBackend ? { rerankBackend } : {}),
  });
}
