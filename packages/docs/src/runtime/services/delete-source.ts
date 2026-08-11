import { getStore } from "../db/index.js";
import { logInfo, logVerbose } from "../lib/logger.js";
import { deleteMetadataCatalog } from "../retrieval/metadata-catalog-store.js";
import { LEDGEINDEX_CHUNKS_INDEX } from "../vector/constants.js";
import { ensureChunksIndex, getVectorStore } from "../vector/store.js";

/**
 * Delete a source row and its vector / catalog side effects.
 * Admin deletes of global sources must clear cloud vectors too — otherwise
 * embeddings outlive the source when the API uses LEDGEINDEX_CLOUD_POSTGRES_URI.
 */
export async function deleteSourceWithIndex(sourceId: string): Promise<boolean> {
  const source = await getStore().getSource(sourceId);
  if (!source) return false;

  await ensureChunksIndex();
  const store = getVectorStore();

  try {
    await store.deleteVectors({
      indexName: LEDGEINDEX_CHUNKS_INDEX,
      filter: { sourceId },
    });
    logVerbose("Deleted vectors for source", "DeleteSource", {
      sourceId,
      scope: source.scope,
    });
  } catch (error) {
    logVerbose("Vector delete skipped or failed", "DeleteSource", {
      sourceId,
      message: error instanceof Error ? error.message : String(error),
    });
  }

  await deleteMetadataCatalog(sourceId);
  const deleted = await getStore().deleteSource(sourceId);

  if (deleted) {
    logInfo("Deleted source set", "DeleteSource", {
      sourceId,
      name: source.name,
      scope: source.scope,
    });
  }

  return deleted;
}
