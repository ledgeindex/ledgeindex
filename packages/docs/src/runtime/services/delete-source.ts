import { isCloudPostgresReadOnly } from "../vector/config.js";
import { getStore } from "../db/index.js";
import { logInfo, logVerbose } from "../lib/logger.js";
import { deleteMetadataCatalog } from "../retrieval/metadata-catalog-store.js";
import { LEDGEINDEX_CHUNKS_INDEX } from "../vector/constants.js";
import { ensureChunksIndex, getVectorStore } from "../vector/store.js";

export async function deleteSourceWithIndex(sourceId: string): Promise<boolean> {
  const source = await getStore().getSource(sourceId);
  if (!source) return false;

  // Never delete remote cloud vectors from a local read-only API.
  if (isCloudPostgresReadOnly() && source.scope === "global") {
    logVerbose("Skipping cloud vector delete (read-only remote)", "DeleteSource", {
      sourceId,
    });
  } else {
    await ensureChunksIndex();
    const store = getVectorStore();

    try {
      await store.deleteVectors({
        indexName: LEDGEINDEX_CHUNKS_INDEX,
        filter: { sourceId },
      });
      logVerbose("Deleted vectors for source", "DeleteSource", { sourceId });
    } catch (error) {
      logVerbose("Vector delete skipped or failed", "DeleteSource", {
        sourceId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  await deleteMetadataCatalog(sourceId);
  const deleted = await getStore().deleteSource(sourceId);

  if (deleted) {
    logInfo("Deleted source set", "DeleteSource", {
      sourceId,
      name: source.name,
    });
  }

  return deleted;
}
