export const LEDGEINDEX_CORE_VERSION = "0.0.0" as const;

export type { MastraContribution } from "./mastra/contribution.js";



export {

  createCoreContext,

  type CoreContext,

  type CreateCoreContextInput,

} from "./context/core-context.js";



export type { SourceRecords } from "./types/source-records.js";

export type { ChunkSearch, ChunkSearchHit, ChunkSearchFilter } from "./types/chunk-search.js";

export type { Embedder } from "./types/embedder.js";

export type { Logger } from "./types/logger.js";

export { noopLogger } from "./types/logger.js";



export {

  chunk,

  chunkMarkdown,

  chunkMarkdownLocalFallback,

  chunkLocalFallback,

  mapToChunkLanguage,

  SEMANTIC_MARKDOWN_MAX_SIZE,

  SEMANTIC_MARKDOWN_OVERLAP,

  SEMANTIC_MARKDOWN_JOIN_THRESHOLD,

  RECURSIVE_CHUNK_MAX_SIZE,

  RECURSIVE_CHUNK_OVERLAP,

  type ChunkStrategy,

  type ChunkOptions,

  type ContentChunk,

  type MarkdownChunk,

} from "./chunk/index.js";



export {

  prepareChunksForPages,

  storePreparedChunks,

  indexPagesForSource,

  getMetadataCatalog,

  prepareExampleChunkDrafts,

  getExampleCodeMaxChars,

  DEFAULT_EXAMPLE_CODE_MAX_CHARS,

  type IndexPageInput,

  type IndexPagesResult,

  type PreparedChunkRecord,

  type IndexProgress,

} from "./chunk-pipeline/index-chunks.js";



export { buildChunkMetadata } from "./chunk-pipeline/chunk-metadata.js";

export { estimateChunkCountFromMarkdown } from "./chunk-pipeline/index-size-estimate.js";

export { markSourceIndexed } from "./chunk-pipeline/source-index-status.js";



export { parsePage, fetchPageHtml, type ParsePageResult } from "./extract/parser/extract-content.js";

export {
  enrichPage,
  hasExampleCandidates,
  detectExampleCandidateSignals,
  classifyHeuristicEnrichSkip,
  buildExampleEmbedText,
  resolveExampleSection,
  ENRICH_MARKDOWN_MAX_CHARS,
  ENRICH_MARKDOWN_HARD_MAX_CHARS,
  ENRICH_MARKDOWN_DEFAULT_MAX_TOKENS,
  ENRICH_MARKDOWN_HARD_MAX_TOKENS,
  countEnrichTokens,
  estimateEnrichTokens,
  resolveEnrichMarkdownMaxTokens,
  resolveEnrichMarkdownMaxChars,
  splitEnrichSections,
  mergeSectionEnrichResults,
  exampleKindSchema,
  exampleLanguageSchema,
  EXAMPLE_LANGUAGES,
  enrichLlmOutputSchema,
  enrichedExampleSchema,
  enrichPageResultSchema,
  enrichSkipReasonSchema,
  isEnrichFailureReason,
  enrichSkipReasonLabel,
  normalizeExampleLanguage,
  type EnrichPageInput,
  type EnrichSectionProgress,
  type EnrichPageResult,
  type EnrichSkipReason,
  type EnrichedExample,
  type ExampleKind,
  type ExampleLanguage,
  type EnrichLlmOutput,
  type ExampleCandidateSignals,
  type HeuristicEnrichSkip,
} from "./enrich/index.js";

export { discoverUrls, cancelDiscoverCrawl, getCrawlProgress } from "./crawl/discover.js";
export {
  filterUrlsByHttpStatus,
  probePageStatus,
  isHttpStatusSkip,
  httpStatusSkipReason,
  HTTP_STATUS_SKIP_PREFIX,
} from "./crawl/validate-page-statuses.js";
export type {
  ProbePageStatusResult,
  FilterUrlsByHttpStatusOptions,
} from "./crawl/validate-page-statuses.js";
export {
  isNonSuccessHttpStatus,
} from "./crawl/not-found-page.js";

export { preflightStartUrl } from "./crawl/preflight.js";

export {
  DEFAULT_CRAWL_USER_AGENT,
  IDENTIFIED_BOT_USER_AGENT,
} from "./crawl/crawl-user-agent.js";

export {
  UNSUPPORTED_PDF_START_URL_MESSAGE,
  UnsupportedStartUrlError,
  assertHtmlStartUrl,
  isPdfContentType,
  isPdfUrl,
} from "./lib/unsupported-start-url.js";

export {
  filterCrawlUrls,
  proposeCrawlFilterRemovals,
} from "./crawl/crawl-url-filter.js";
export type {
  CrawlUrlFilterEntry,
  CrawlUrlFilterMessage,
  CrawlUrlFilterResult,
  CrawlUrlFilterModelSelection,
  CrawlUrlRemovalsResult,
} from "./crawl/crawl-url-filter.js";

export { dedupeUrlsByCanonical } from "./crawl/canonical-dedupe.js";



export { embedTexts, embedQuery } from "./vector/embedding.js";

export {
  getVectorStore,
  ensureChunksIndex,
  assertVectorStoreWritable,
} from "./vector/store.js";

export { getStore } from "./db/index.js";



export { kapaRetrieve } from "./query/kapa-retrieve.js";

export { queryExamples } from "./query/query-examples.js";
export type {
  QueryExamplesHit,
  QueryExamplesInput,
  QueryExamplesResult,
} from "./query/query-examples.js";

export { findExamples } from "./query/find-examples.js";
export type {
  FindExamplesInput,
  FindExamplesResult,
  FindExamplesRetrievalMeta,
  FindExamplesSearchAttempt,
  FoundExample,
} from "./query/find-examples.js";
export {
  buildExampleCatalogFromMetadata,
  formatExampleCatalogText,
  type ExampleCatalog,
  type ExampleCatalogEntry,
} from "./query/example-catalog.js";

export {
  getExampleCatalog,
  saveExampleCatalog,
  deleteExampleCatalog,
} from "./query/example-catalog-store.js";

export { rewriteExampleQueries } from "./query/rewrite-example-queries.js";

export { ensureCatalogHasPages } from "./query/page-catalog-rebuild.js";



export { getDataDir, dataPath } from "./lib/data-dir.js";

export {
  getEnrichModel,
  hasEnrichLlm,
  resolveEnrichModelFromSelection,
  buildLmStudioMastraModel,
  getLmStudioModelId,
  getCachedLmStudioActiveModelId,
  probeLmStudioActiveModelId,
  resolveLmStudioModelId,
  DEFAULT_ENRICH_LM_STUDIO_ID,
  DEFAULT_ENRICH_OPENAI_ID,
  DEFAULT_ENRICH_GOOGLE_ID,
} from "./llm/models.js";

export {

  assertIngestNotCancelled,

  cancelIngestForSource,

  IngestCancelledError,

} from "./ingest/ingest-cancel.js";

