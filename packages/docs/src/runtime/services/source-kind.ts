import { getStore } from "../db/index.js";
import type { SourceMetadata } from "../db/types.js";
import { logVerbose } from "../lib/logger.js";

/**
 * Repo indexing writes into an ordinary source row, so without this nothing
 * upstream of retrieval can tell a git checkout from a crawled site. A router
 * has to know that before it retrieves, not after it sees `filePath` on a hit.
 */
export async function markSourceAsRepository(sourceId: string): Promise<void> {
  const source = await getStore().getSource(sourceId);
  if (!source) return;

  const existing = source.sourceMetadata;
  if (existing?.sourceType === "repository") return;

  const sourceMetadata: SourceMetadata = {
    ...(existing ?? { origin: "external", detectedSignals: [] }),
    sourceType: "repository",
    sourceTypeConfidence: 1,
  };

  await getStore().updateSource(sourceId, { sourceMetadata });
  logVerbose("Marked source as repository", "SourceKind", { sourceId });
}
