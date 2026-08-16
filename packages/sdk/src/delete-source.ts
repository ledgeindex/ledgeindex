import { deleteSourceWithIndex } from "@ledgeindex/docs/runtime/services/delete-source.js";
import { resolveSourceRef } from "./sources.js";

export async function deleteSource(
  sourceIdOrSlug: string,
): Promise<{ deleted: boolean; sourceId: string }> {
  const { sourceId } = await resolveSourceRef(sourceIdOrSlug);
  const deleted = await deleteSourceWithIndex(sourceId);
  return { deleted, sourceId };
}
