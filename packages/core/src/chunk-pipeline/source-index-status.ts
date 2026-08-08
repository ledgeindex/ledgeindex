import { getStore } from "../db/index.js";
import { getVectorBackend } from "../vector/config.js";

export async function markSourceIndexed(input: {
  sourceId: string;
  pageCount: number;
  chunkCount: number;
}) {
  await getStore().updateSource(input.sourceId, {
    indexedAt: new Date().toISOString(),
    indexStats: {
      pageCount: input.pageCount,
      chunkCount: input.chunkCount,
      vectorBackend: getVectorBackend(),
    },
  });
}
