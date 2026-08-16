import { listSourceSetSummaries } from "@ledgeindex/docs/runtime/services/source-set-summary.js";
import { saveSourceSet } from "@ledgeindex/docs/runtime/services/source-set-write.js";
import { getLocalUserId } from "./runtime.js";
import { resolveSourceRef } from "./sources.js";
import type { LedgeIndexSourceSet, LedgeIndexSaveSourceSetOptions } from "./types.js";

export async function listSourceSets(): Promise<LedgeIndexSourceSet[]> {
  return listSourceSetSummaries(getLocalUserId());
}

/** Create or update a set by slug — the sources a routed ask may choose from. */
export async function saveSet(
  options: LedgeIndexSaveSourceSetOptions,
): Promise<LedgeIndexSourceSet> {
  const sourceIds = await Promise.all(
    options.sources.map(async (ref) => {
      const { sourceId } = await resolveSourceRef(ref);
      return sourceId;
    }),
  );

  const ownerUserId = getLocalUserId();
  const set = await saveSourceSet({
    ownerUserId,
    name: options.name,
    ...(options.slug ? { slug: options.slug } : {}),
    ...(options.description !== undefined
      ? { description: options.description }
      : {}),
    sourceIds,
  });

  const sets = await listSourceSetSummaries(ownerUserId);
  const summary = sets.find((entry) => entry.id === set.id);
  if (!summary) {
    throw new Error(`Source set was saved but could not be read back: ${set.slug}`);
  }
  return summary;
}
