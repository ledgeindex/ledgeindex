import { logInfo, logVerbose } from "../lib/logger.js";
import { getStore } from "../db/index.js";
import { assertIngestNotCancelled } from "../ingest/ingest-cancel.js";
import { buildChunkId } from "./chunk-id.js";
import { buildChunkMetadata, matchCrawlRootForUrl } from "./chunk-metadata.js";
import {
  chunk,
  type ChunkStrategy,
  type ContentChunk,
} from "../chunk/chunk.js";
import { chunkMarkdown } from "../chunk/chunk-markdown.js";
import { prepareExampleChunkDrafts } from "./prepare-example-chunks.js";
import type { EnrichPageResult } from "../enrich/schemas.js";
import type { MetadataCatalog } from "../query/metadata-catalog.js";
import {
  getMetadataCatalog,
  saveMetadataCatalog,
} from "../query/metadata-catalog-store.js";
import { buildMetadataCatalog } from "../query/page-catalog.js";
import { buildExampleCatalogFromMetadata } from "../query/example-catalog.js";
import {
  deleteLexicalChunks,
  upsertLexicalChunks,
} from "../query/lexical-store.js";
import { saveExampleCatalog } from "../query/example-catalog-store.js";
import { embedTexts } from "../vector/embedding.js";
import { LEDGEINDEX_CHUNKS_INDEX } from "../vector/constants.js";
import {
  assertVectorStoreWritable,
  ensureChunksIndex,
  getVectorStore,
} from "../vector/store.js";
import { markSourceIndexed } from "./source-index-status.js";

export type IndexPageInput = {
  url: string;
  title: string;
  markdown: string;
  language?: string;
  contentType?: string;
  enrichment?: EnrichPageResult | null;
  /**
   * Chunk strategy for this page. Docs default to semantic-markdown;
   * repository files should use recursive + chunkLanguage.
   */
  chunkStrategy?: ChunkStrategy;
  /** Programming / Mastra language for recursive strategy (ts, js, markdown, …). */
  chunkLanguage?: string | null;
  /**
   * Chunks the caller already produced. Set by the repo indexer, which splits
   * code on declaration boundaries and needs to attach line ranges and symbol
   * names per chunk. When present, no splitter runs for this page and each
   * chunk's `metadata` is merged onto the stored record.
   */
  chunks?: ContentChunk[];
  /**
   * Facet overrides. Crawled docs leave these unset and get segments derived
   * from the URL; repo files pass directory-derived values because every blob
   * URL in a repo shares the same leading segments.
   */
  category?: string | null;
  section?: string | null;
  /** Role of the page (source, test, example, docs, config) for query-time weighting. */
  pageKind?: string | null;
  /**
   * Path within a repository checkout. Set for every page of a repo source,
   * including its docs, since this is what marks the source as code at query
   * time. Per-chunk metadata from the AST chunker still wins where present.
   */
  filePath?: string | null;
};

export type IndexPagesResult = {
  chunkCount: number;
  pageCount: number;
  catalog: MetadataCatalog;
};

export type PreparedChunkRecord = {
  id: string;
  text: string;
  vector: number[];
  metadata: Record<string, unknown>;
};

export type IndexProgress = {
  phase: "chunking" | "embedding" | "storing";
  current: number;
  total: number;
  /** Page URL currently being chunked (multi-path progress UI). */
  sectionUrl?: string;
};

const EMBED_BATCH_SIZE = 32;

export async function prepareChunksForPages(input: {
  sourceId: string;
  projectId: string;
  pages: IndexPageInput[];
  sourceMetadata?: import("../schemas/source-metadata.js").SourceMetadata | null;
  /** Crawl root for this ingest run (multi-path sources). */
  crawlRoot?: string | null;
  /** All crawl roots on the source — per-page longest-prefix match when set. */
  crawlRoots?: string[] | null;
  onProgress?: (progress: IndexProgress) => void;
}): Promise<PreparedChunkRecord[]> {
  const { sourceId, projectId, pages, onProgress } = input;
  const crawlRoots =
    input.crawlRoots?.map((url) => url.trim()).filter(Boolean) ??
    (input.crawlRoot?.trim() ? [input.crawlRoot.trim()] : []);
  const sourceMetadata =
    input.sourceMetadata ??
    (await getStore().getSource(sourceId))?.sourceMetadata ??
    null;
  const sourceRecord = await getStore().getSource(sourceId);
  const chunkDrafts: Array<{
    id: string;
    text: string;
    metadata: Record<string, unknown>;
  }> = [];

  const pagesWithContent = pages.filter((page) => page.markdown.trim().length > 0);
  const pageTotal = Math.max(pagesWithContent.length, 1);

  for (const [pageIndex, page] of pagesWithContent.entries()) {
    assertIngestNotCancelled(sourceId);

    onProgress?.({
      phase: "chunking",
      current: pageIndex + 1,
      total: pageTotal,
      sectionUrl: page.url,
    });

    const strategy = page.chunkStrategy ?? "semantic-markdown";
    // Only caller-supplied chunks contribute metadata; the splitters attach
    // their own bookkeeping that has no place in the stored record.
    const preChunked = Boolean(page.chunks?.length);
    const chunks = page.chunks?.length
      ? page.chunks
      : strategy === "recursive"
        ? await chunk(page.markdown, {
            strategy: "recursive",
            language: page.chunkLanguage ?? page.language ?? null,
          })
        : await chunkMarkdown(page.markdown);
    const pageCrawlRoot =
      matchCrawlRootForUrl(page.url, crawlRoots) ?? crawlRoots[0] ?? null;
    const chunkKind = strategy === "recursive" ? "code" : "markdown";
    const metadataLanguage =
      strategy === "recursive"
        ? (page.chunkLanguage ?? page.language ?? "en")
        : (page.language ?? "en");
    for (const [chunkIndex, part] of chunks.entries()) {
      const metadata = buildChunkMetadata({
        text: part.text,
        url: page.url,
        title: page.title,
        sourceId,
        projectId,
        chunkIndex,
        language: metadataLanguage,
        contentType: page.contentType,
        sourceMetadata,
        versionLabel: sourceRecord?.versionLabel ?? sourceMetadata?.version ?? null,
        versionNumber: sourceRecord?.versionNumber ?? null,
        sourceFamilyId: sourceRecord?.sourceFamilyId ?? sourceId,
        crawlRoot: pageCrawlRoot,
        category: page.category,
        section: page.section,
        filePath: page.filePath,
      });

      chunkDrafts.push({
        id: buildChunkId({ sourceId, url: page.url, chunkIndex }),
        text: part.text,
        metadata: {
          ...metadata,
          ...(preChunked ? (part.metadata ?? {}) : {}),
          chunkKind,
          tokenCount: part.tokenCount,
          charCount: part.charCount,
          ...(page.pageKind ? { pageKind: page.pageKind } : {}),
        },
      });
    }

    if (page.enrichment?.status === "enriched") {
      const exampleDrafts = await prepareExampleChunkDrafts({
        sourceId,
        projectId,
        url: page.url,
        title: page.title,
        enrichment: page.enrichment,
        baseMetadata: {
          contentType: page.contentType ?? "html",
          versionLabel:
            sourceRecord?.versionLabel ?? sourceMetadata?.version ?? null,
          versionNumber: sourceRecord?.versionNumber ?? null,
          sourceFamilyId: sourceRecord?.sourceFamilyId ?? sourceId,
        },
      });
      chunkDrafts.push(
        ...exampleDrafts.map((draft) =>
          pageCrawlRoot
            ? {
                ...draft,
                metadata: { ...draft.metadata, crawlRoot: pageCrawlRoot },
              }
            : draft,
        ),
      );
    }
  }

  if (chunkDrafts.length === 0) return [];

  logVerbose("Embedding chunks (FastEmbed local / Gemini prod)", "IndexChunks", {
    sourceId,
    chunkCount: chunkDrafts.length,
  });

  const prepared: PreparedChunkRecord[] = [];
  const chunkTotal = chunkDrafts.length;

  for (let offset = 0; offset < chunkDrafts.length; offset += EMBED_BATCH_SIZE) {
    assertIngestNotCancelled(sourceId);

    const batch = chunkDrafts.slice(offset, offset + EMBED_BATCH_SIZE);
    const vectors = await embedTexts(batch.map((item) => item.text));

    for (const [index, item] of batch.entries()) {
      prepared.push({
        ...item,
        vector: [...(vectors[index] ?? [])],
      });
    }

    onProgress?.({
      phase: "embedding",
      current: Math.min(offset + batch.length, chunkTotal),
      total: chunkTotal,
    });
  }

  return prepared;
}

export async function storePreparedChunks(input: {
  sourceId: string;
  prepared: PreparedChunkRecord[];
  pageCount: number;
  replaceMode?: "all" | "incremental";
  onProgress?: (progress: IndexProgress) => void;
}): Promise<IndexPagesResult> {
  const { sourceId, prepared, pageCount, onProgress } = input;
  const replaceMode = input.replaceMode ?? "all";
  assertIngestNotCancelled(sourceId);
  assertVectorStoreWritable();

  await ensureChunksIndex();

  const store = getVectorStore();
  const chunkTotal = Math.max(prepared.length, 1);

  onProgress?.({ phase: "storing", current: 0, total: chunkTotal });

  if (replaceMode === "all") {
    try {
      await store.deleteVectors({
        indexName: LEDGEINDEX_CHUNKS_INDEX,
        filter: { sourceId },
      });
    } catch (error) {
      logVerbose("No prior chunks to delete (or delete unsupported)", "IndexChunks", {
        sourceId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
    await deleteLexicalChunks({ sourceId });
  }

  if (prepared.length === 0) {
    const emptyCatalog = await saveMetadataCatalog(sourceId, {
      sourceId,
      categories: [],
      pages: [],
      updatedAt: new Date().toISOString(),
    });
    return { chunkCount: 0, pageCount, catalog: emptyCatalog };
  }

  onProgress?.({
    phase: "storing",
    current: Math.floor(chunkTotal * 0.35),
    total: chunkTotal,
  });

  // An id appearing twice in one write means one chunk silently replaces the
  // other in the vector store and fans out into duplicate lexical rows, so
  // assert the invariant here rather than let it degrade retrieval quietly.
  const uniqueIds = new Set(prepared.map((item) => item.id));
  if (uniqueIds.size !== prepared.length) {
    throw new Error(
      `Chunk id collision: ${prepared.length - uniqueIds.size} of ${prepared.length} chunks share an id for source ${sourceId}`,
    );
  }

  await store.upsert({
    indexName: LEDGEINDEX_CHUNKS_INDEX,
    vectors: prepared.map((item) => item.vector),
    metadata: prepared.map((item) => item.metadata),
    ids: prepared.map((item) => item.id),
  });

  const lexicalWritten = await upsertLexicalChunks(
    prepared.map((item) => ({
      id: item.id,
      sourceId,
      url: String(item.metadata.url ?? ""),
      text: item.text,
      metadata: item.metadata,
    })),
  );
  if (lexicalWritten > 0) {
    logVerbose("Lexical chunks written", "IndexChunks", {
      sourceId,
      lexicalWritten,
    });
  }

  onProgress?.({
    phase: "storing",
    current: Math.floor(chunkTotal * 0.8),
    total: chunkTotal,
  });

  let catalog = buildMetadataCatalog(
    sourceId,
    prepared.map((item) => item.metadata),
  );

  if (replaceMode === "incremental") {
    const rebuilt = await import("../query/page-catalog-rebuild.js").then(
      (mod) => mod.ensureCatalogHasPages(sourceId),
    );
    if (rebuilt) {
      catalog = rebuilt;
    }
  }

  await saveMetadataCatalog(sourceId, catalog);

  const exampleCatalog = buildExampleCatalogFromMetadata(
    sourceId,
    prepared.map((item) => item.metadata),
  );
  await saveExampleCatalog(sourceId, exampleCatalog);

  onProgress?.({ phase: "storing", current: chunkTotal, total: chunkTotal });

  logInfo("Indexed pages into vector store", "IndexChunks", {
    sourceId,
    pageCount,
    chunkCount: prepared.length,
    categories: catalog.categories.length,
  });

  return {
    chunkCount: prepared.length,
    pageCount,
    catalog,
  };
}

export async function indexPagesForSource(input: {
  sourceId: string;
  projectId: string;
  pages: IndexPageInput[];
  onProgress?: (progress: IndexProgress) => void;
}): Promise<IndexPagesResult> {
  const prepared = await prepareChunksForPages(input);
  const result = await storePreparedChunks({
    sourceId: input.sourceId,
    prepared,
    pageCount: input.pages.length,
    onProgress: input.onProgress,
  });
  await markSourceIndexed({
    sourceId: input.sourceId,
    pageCount: result.pageCount,
    chunkCount: result.chunkCount,
  });
  return result;
}

export { getMetadataCatalog };

export {
  prepareExampleChunkDrafts,
  getExampleCodeMaxChars,
  DEFAULT_EXAMPLE_CODE_MAX_CHARS,
} from "./prepare-example-chunks.js";

