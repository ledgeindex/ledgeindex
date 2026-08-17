import { logInfo, logVerbose } from "../lib/logger.js";
import { embedQuery } from "../vector/embedding.js";
import { LEDGEINDEX_CHUNKS_INDEX } from "../vector/constants.js";
import { ensureChunksIndex, getVectorStore } from "../vector/store.js";
import type {
  MetadataCatalog,
  MetadataCatalogPage,
} from "./metadata-catalog.js";
import {
  getMetadataCatalog,
  saveMetadataCatalog,
} from "./metadata-catalog-store.js";
import {
  buildMetadataCatalog,
  buildPageCatalogFromMetadata,
} from "./page-catalog.js";

const REBUILD_TOP_K = 10_000;
const REBUILD_QUERY_TERMS = [
  "documentation",
  "api reference guide",
  "tutorial overview",
  "page content",
];

async function fetchChunkMetadataForSource(
  sourceId: string
): Promise<Record<string, unknown>[]> {
  await ensureChunksIndex();
  const store = getVectorStore();
  const byVectorId = new Map<string, Record<string, unknown>>();

  for (const term of REBUILD_QUERY_TERMS) {
    const queryVector = await embedQuery(term);
    const results = await store.query({
      indexName: LEDGEINDEX_CHUNKS_INDEX,
      queryVector,
      topK: REBUILD_TOP_K,
      filter: { sourceId },
    });

    for (const result of results) {
      const id = String(result.id ?? "").trim();
      if (!id || byVectorId.has(id)) continue;
      byVectorId.set(id, (result.metadata ?? {}) as Record<string, unknown>);
    }
  }

  return [...byVectorId.values()];
}

/** Backfill page list for catalogs indexed before pages were stored. */
export async function rebuildPageCatalogFromVector(
  sourceId: string
): Promise<MetadataCatalogPage[]> {
  const metadata = await fetchChunkMetadataForSource(sourceId);
  const pages = buildPageCatalogFromMetadata(metadata);

  logVerbose("Rebuilt page catalog from vector store", "PageCatalog", {
    sourceId,
    chunkHits: metadata.length,
    pageCount: pages.length,
  });

  return pages;
}

export async function rebuildFullCatalogFromVector(
  sourceId: string
): Promise<MetadataCatalog | null> {
  const metadata = await fetchChunkMetadataForSource(sourceId);
  if (metadata.length === 0) return null;

  const catalog = buildMetadataCatalog(sourceId, metadata);

  logInfo("Rebuilt metadata catalog from vector store", "PageCatalog", {
    sourceId,
    chunkHits: metadata.length,
    pageCount: catalog.pages.length,
    categoryCount: catalog.categories.length,
  });

  return catalog;
}

export async function ensureCatalogHasPages(
  sourceId: string
): Promise<MetadataCatalog | null> {
  const catalog = await getMetadataCatalog(sourceId);
  if (catalog?.pages?.length) {
    return catalog;
  }

  const rebuilt =
    catalog != null
      ? {
          ...catalog,
          pages: await rebuildPageCatalogFromVector(sourceId),
          updatedAt: new Date().toISOString(),
        }
      : await rebuildFullCatalogFromVector(sourceId);

  if (!rebuilt || rebuilt.pages.length === 0) {
    return null;
  }

  await saveMetadataCatalog(sourceId, rebuilt);
  return rebuilt;
}
