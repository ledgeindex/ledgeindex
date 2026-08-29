declare module "@ledgeindex/docs" {
  export function createDocsMastraContribution(): DocsMastraContribution;
}

type DocsMastraContribution = {
  id: string;
  agents?: Record<string, unknown>;
  workflows?: Record<string, unknown>;
  vectors?: Record<string, unknown>;
  mcpServers?: Record<string, unknown>;
  storage?: unknown;
  logger?: unknown;
  observability?: unknown;
  server?: unknown;
};

declare module "@ledgeindex/core/export/source-corpus.js" {
  export type SourceCorpusChunk = {
    id: string;
    chunkIndex: number;
    text: string;
    title: string;
    url: string;
    category: string;
    section: string;
    headingPath: string[];
    chunkKind: string;
    contentType?: string;
    language?: string;
    crawlRoot?: string;
    filePath?: string;
    startLine?: number;
    endLine?: number;
    symbolName?: string;
    symbolKind?: string;
    pageKind?: string;
  };

  export type SourceCorpusPage = {
    url: string;
    title: string;
    contentHash: string | null;
    category: string;
    crawlRoot: string | null;
    chunkCount: number;
    markdown: string;
    chunks: SourceCorpusChunk[];
  };

  export type SourceCorpusExport = {
    format: "ledgeindex.source-corpus";
    formatVersion: 1;
    exportedAt: string;
    source: {
      id: string;
      slug: string;
      name: string;
      scope: "personal" | "global";
      hosting: "local" | "cloud";
      canonicalUrl: string | null;
      indexedAt: string | null;
      versionNumber: number;
      versionLabel: string;
      startUrls: string[];
    };
    index: {
      vectorBackend: string;
      catalogUpdatedAt: string;
      pageCount: number;
      chunkCount: number;
    };
    pages: SourceCorpusPage[];
  };

  export type SourceCorpusExportOptions = {
    includeContent?: boolean;
    includeChunks?: boolean;
  };

  export const PROFILE_SEED_MAX_PAGES: number;
  export const PROFILE_SEED_MAX_MARKDOWN_CHARS: number;
  export function sourceCorpusPagesToProfileSeedPages(
    pages: readonly SourceCorpusPage[],
    options?: { maxPages?: number; maxMarkdownChars?: number },
  ): Array<{ url: string; title: string; markdown: string }>;

  export type WrittenSourceCorpus = {
    outputDirectory: string;
    manifestPath: string;
    pageFiles: string[];
  };

  export type SourceCorpusPageLayout =
    | "directory-index"
    | "named-files";

  export type SourceCorpusWriteOptions = {
    pageLayout?: SourceCorpusPageLayout;
  };

  export function exportSourceCorpus(
    sourceId: string,
    options?: SourceCorpusExportOptions,
  ): Promise<SourceCorpusExport>;

  export function writeSourceCorpusToDirectory(
    corpus: SourceCorpusExport,
    outputDirectory: string,
    options?: SourceCorpusWriteOptions,
  ): Promise<WrittenSourceCorpus>;
}

declare module "@ledgeindex/docs/runtime/mastra/instance.js" {
  import type { Mastra } from "@mastra/core/mastra";
  export function setMastraInstance(mastra: Mastra): void;
}

declare module "@ledgeindex/core/schemas/source-config.js" {
  export type WebCrawlSourceConfig = {
    startUrls: string[];
    includePatterns: string[];
    excludePatterns: string[];
    excludeDownloadPatterns: string[];
    patternsAreRegex: boolean;
    renderJs: boolean;
    useProxy: boolean;
    enableSitemap: boolean;
    sitemapOnly: boolean;
    sitemapUrls: string[];
    fileTypes: string[];
    contentSelectors: string[];
    excludeSelectors: string[];
    maxPages: number;
    userAgent: string;
  };
}

declare module "@ledgeindex/docs/runtime/db/types.js" {
  export type SourceScope = "personal" | "global";
  export type SourceMetadata = {
    version?: string;
    [key: string]: unknown;
  };
  export type Source = {
    id: string;
    projectId: string;
    name: string;
    slug: string;
    scope: SourceScope;
    config: import("@ledgeindex/core/schemas/source-config.js").WebCrawlSourceConfig;
  };
  export type SourceSummary = {
    id: string;
    name: string;
    slug: string;
    sourceType: string;
  };
  export type SourceSetSummary = {
    id: string;
    name: string;
    slug: string;
    description: string | null;
    sourceCount: number;
    sources: Array<{
      id: string;
      slug: string;
      name: string;
      sourceType: string;
    }>;
  };
  export function normalizeCreateHosting(input: {
    scope: SourceScope;
    hosting?: string;
  }): string;
}

declare module "@ledgeindex/docs/runtime/db/index.js" {
  import type { Source } from "@ledgeindex/docs/runtime/db/types.js";
  import type { SourceMetadata, SourceScope } from "@ledgeindex/docs/runtime/db/types.js";

  type Project = { id: string; name: string; ownerUserId: string };

  type Store = {
    listProjects(ownerUserId: string): Promise<Project[]>;
    createProject(name: string, ownerUserId: string): Promise<Project>;
    getOrCreatePlatformProject(): Promise<Project>;
    getSource(id: string): Promise<Source | null>;
    listSourcesByCanonicalUrl(
      canonicalUrl: string,
      scope: SourceScope,
      slugOwnerKey: string,
    ): Promise<Source[]>;
    createSource(input: Record<string, unknown>): Promise<Source>;
    updateSource(
      id: string,
      input: Record<string, unknown>,
    ): Promise<Source | null>;
  };

  export function getStore(): Store;
}

declare module "@ledgeindex/docs/runtime/lib/canonical-url.js" {
  export function normalizeCanonicalUrl(raw: string): string;
}

declare module "@ledgeindex/docs/runtime/services/source-resolve.js" {
  import type { SourceScope } from "@ledgeindex/docs/runtime/db/types.js";

  export function slugOwnerKeyForSource(
    scope: SourceScope,
    ownerUserId: string | null,
  ): string;

  export function allocateSourceSlug(input: {
    name: string;
    scope: SourceScope;
    ownerUserId: string | null;
    preferredSlug?: string | null;
  }): Promise<string>;
}

declare module "@ledgeindex/docs/runtime/services/source-set-limits.js" {
  import type { SourceScope } from "@ledgeindex/docs/runtime/db/types.js";
  export function assertCanCreateSource(
    userId: string,
    scope: SourceScope,
  ): Promise<void>;
}

declare module "@ledgeindex/docs/runtime/services/source-summary.js" {
  import type { SourceSummary } from "@ledgeindex/docs/runtime/db/types.js";
  export function listSourceSummariesForOwner(
    ownerUserId: string,
  ): Promise<SourceSummary[]>;
}

declare module "@ledgeindex/docs/runtime/services/source-set-summary.js" {
  import type { SourceSetSummary } from "@ledgeindex/docs/runtime/db/types.js";
  export function listSourceSetSummaries(
    userId: string,
  ): Promise<SourceSetSummary[]>;
}

declare module "@ledgeindex/docs/runtime/services/source-set-write.js" {
  export function saveSourceSet(input: {
    ownerUserId: string;
    name: string;
    slug?: string;
    description?: string | null;
    sourceIds: string[];
  }): Promise<{ id: string; slug: string }>;
}

declare module "@ledgeindex/docs/runtime/services/source-versioning.js" {
  import type { Source } from "@ledgeindex/docs/runtime/db/types.js";

  export function resolveVersionFieldsForCreate(input: {
    startUrl: string;
    detectedVersion?: string | null;
    userVersionLabel?: string | null;
    versionMode: "new" | "replace";
    familySources: Source[];
    replaceSource?: Source;
  }): {
    canonicalUrl: string;
    sourceFamilyId?: string | null;
    versionNumber: number;
    versionLabel: string;
  };
}

declare module "@ledgeindex/docs/runtime/services/delete-source.js" {
  export function deleteSourceWithIndex(sourceId: string): Promise<boolean>;
}

declare module "@ledgeindex/docs/runtime/services/source-ask.js" {
  import type { RerankBackend } from "@ledgeindex/core/query/rerank-backend.js";

  export type SourceAskHit = {
    text: string;
    url: string;
    title: string;
    score: number;
  };

  export type AskCitation = {
    name: string;
    url: string;
    score: number;
    filePath?: string;
    startLine?: number;
    endLine?: number;
  };

  export type SourceAskResult = {
    answer: string;
    chunks: SourceAskHit[];
    citations: AskCitation[];
    insufficient: boolean;
  };

  export function askSource(
    sourceId: string,
    message: string,
    options?: { rerankBackend?: RerankBackend },
  ): Promise<SourceAskResult>;
}

declare module "@ledgeindex/docs/runtime/services/source-kind.js" {
  export function markSourceAsRepository(sourceId: string): Promise<void>;
}

declare module "@ledgeindex/docs/runtime/services/routed-ask.js" {
  import type { RerankBackend } from "@ledgeindex/core/query/rerank-backend.js";
  import type {
    AskCitation,
    SourceAskHit,
  } from "@ledgeindex/docs/runtime/services/source-ask.js";

  export type RoutedAskPickedSource = {
    id: string;
    slug: string;
    name: string;
    kind: "code" | "docs";
  };

  export type RoutedAskResult = {
    answer: string;
    chunks: SourceAskHit[];
    citations: AskCitation[];
    insufficient: boolean;
    pickedSources: RoutedAskPickedSource[];
  };

  export function askRouted(
    question: string,
    options?: {
      sourceSet?: string;
      sources?: string[];
      sourceMode?: "picker" | "all";
      userId?: string;
      rerankBackend?: RerankBackend;
    },
  ): Promise<RoutedAskResult>;
}

declare module "@ledgeindex/core/crawl/preflight.js" {
  import type { SourceMetadata } from "@ledgeindex/docs/runtime/db/types.js";

  export type PreflightResult = {
    ok: boolean;
    status: number;
    siteName: string;
    siteSlug: string;
    ogImage?: string;
    faviconUrl?: string;
    metadata?: SourceMetadata;
  };

  export function preflightStartUrl(url: string): Promise<PreflightResult>;
}

declare module "@ledgeindex/core/crawl/crawl-url-filter.js" {
  export function proposeCrawlFilterRemovals(input: {
    urls: Array<{ index: number; url: string; title?: string }>;
    startUrls?: string[];
  }): Promise<{ removeIndexes: number[] }>;
}

declare module "@ledgeindex/core/crawl/crawl-user-agent.js" {
  export const DEFAULT_CRAWL_USER_AGENT: string;
}

declare module "@ledgeindex/core/crawl/header-nav-paths.js" {
  export type HeaderNavPath = { url: string; label: string };
  export function mergeHeaderNavStartUrls(
    primaryUrl: string,
    siblingUrls: string[],
  ): string[];
}

declare module "@ledgeindex/docs/runtime/crawler/discover-header-nav.js" {
  export type HeaderNavProviderId = "google" | "openai" | "deepseek";
  export type HeaderNavDiscoveryResult = {
    seed: { url: string; label: string };
    paths: Array<{ url: string; label: string }>;
    isTopNavbar: boolean;
    reason: string;
  };
  export function discoverHeaderNavPathsInternal(
    rawUrl: string,
    preferredProvider?: HeaderNavProviderId,
  ): Promise<HeaderNavDiscoveryResult>;
}

declare module "@ledgeindex/docs/runtime/crawler/discover.js" {
  export type CrawlProgressState = {
    status: "running" | "done";
    phase?: "discovering" | "validating";
    pagesDiscovered: number;
    maxPages: number;
    validatedCount?: number;
    validationTotal?: number;
    httpErrorCount?: number;
  };

  export function getCrawlProgress(sourceId: string): CrawlProgressState | null;
}

declare module "@ledgeindex/docs/runtime/ingest/pipeline-status.js" {
  export type IngestPipelineSnapshot = {
    runId: string;
    status: string;
    suspendedStep?: string;
    suspendPayload?: unknown;
    error?: string;
    liveProgress?: { current: number; total: number };
    livePhase?: string;
    result?: { pageCount?: number; chunkCount?: number };
  };
}

declare module "@ledgeindex/docs/runtime/ingest/workflow-runner.js" {
  import type { WebCrawlSourceConfig } from "@ledgeindex/core/schemas/source-config.js";
  import type { IngestPipelineSnapshot } from "@ledgeindex/docs/runtime/ingest/pipeline-status.js";

  export function startIngestWorkflow(input: {
    sourceId: string;
    projectId: string;
    config: WebCrawlSourceConfig;
  }): Promise<IngestPipelineSnapshot>;

  export function resumeIngestWorkflow(input: {
    runId: string;
    step: string;
    resumeData: Record<string, unknown>;
  }): Promise<IngestPipelineSnapshot>;

  export function getIngestWorkflowStatus(
    runId: string,
  ): Promise<IngestPipelineSnapshot | null>;
}

declare module "@ledgeindex/core/query/rerank-backend.js" {
  export type RerankBackend = "cohere" | "local-auto" | "vector" | string;
}

declare module "@ledgeindex/core/vector/config.js" {
  export type VectorBackend = "libsql" | "pgvector";
}

declare module "@ledgeindex/docs/runtime/refresh/active-refresh-runs.js" {
  export type RefreshPageRef = {
    url: string;
    title: string;
    indexedUrl?: string;
  };

  export type RefreshChangelog = {
    baselineCaptured: boolean;
    unchangedCount: number;
    added: RefreshPageRef[];
    updated: RefreshPageRef[];
    removed: RefreshPageRef[];
  };

  export type RefreshMode = "discover" | "selected" | "probe";

  export type RefreshRunStatus =
    | "discovering"
    | "parsing"
    | "comparing"
    | "ready"
    | "applying"
    | "done"
    | "cancelled"
    | "failed";

  export type RefreshRunPhase =
    | "discovering"
    | "parsing"
    | "comparing"
    | "deleting"
    | "chunking"
    | "embedding"
    | "storing"
    | "done";

  export type RefreshRunSnapshot = {
    runId: string;
    sourceId: string;
    crawlRunId: string;
    mode: RefreshMode;
    status: RefreshRunStatus;
    phase: RefreshRunPhase;
    current: number;
    total: number;
    activePath?: string;
    pathIndex?: number;
    pathTotal?: number;
    changelog?: RefreshChangelog;
    error?: string;
  };
}

declare module "@ledgeindex/docs/runtime/services/source-refresh.js" {
  import type {
    RefreshMode,
    RefreshRunSnapshot,
  } from "@ledgeindex/docs/runtime/refresh/active-refresh-runs.js";

  export function startSourceRefreshCheck(
    sourceId: string,
    options?: { mode?: RefreshMode },
  ): Promise<RefreshRunSnapshot>;

  export function applySourceRefresh(
    sourceId: string,
  ): Promise<RefreshRunSnapshot>;

  export function getSourceRefreshStatus(
    sourceId: string,
  ): RefreshRunSnapshot | null;
}

declare module "@ledgeindex/repo" {
  export type RepoIndexProgress =
    | { phase: "clone"; detail: string }
    | {
        phase: "scan";
        current: number;
        total: number;
        filePath?: string;
      }
    | {
        phase: "chunking" | "embedding" | "storing";
        current: number;
        total: number;
        sectionUrl?: string;
      };

  export function indexRepoCheckout(input: {
    sourceId: string;
    projectId: string;
    checkoutPath?: string;
    githubUrl?: string | null;
    ref?: string | null;
    sourceSlug?: string | null;
    maxFiles?: number;
    includeTests?: boolean;
    includeReadme?: boolean;
    extensions?: string[];
    onProgress?: (progress: RepoIndexProgress) => void;
  }): Promise<{
    fileCount: number;
    pageCount: number;
    chunkCount: number;
    astChunkedFiles: number;
    astFallbackFiles: number;
    exportedSymbolCount: number;
    checkoutPath: string;
    commitSha?: string;
  }>;
}
declare module "@ledgeindex/profile" {
  export type ResearchLens = string;
  export type SeedCatalogPage = {
    url: string;
    title: string;
    markdown?: string;
  };
  export type DocsIdentityLensOutput = {
    overallSummary: string;
    kind: "frameworks" | "libraries" | "apis-services" | "tooling" | "uncategorized";
    language: "javascript" | "typescript" | "python" | "other";
    notes?: string;
    citations?: Array<{ url: string; quote?: string }>;
  };
  export type CapabilitiesLensOutput = {
    capabilities: Array<{
      name: string;
      description: string;
      priority: "main" | "top" | "supporting";
      tierOrLimit?: string;
      citation: { url: string; quote?: string };
    }>;
    gapsOrUnclear?: string;
  };

  export type CompanyProfileProgress = {
    phase: "crawl" | "pick" | "fetch" | "synthesize";
    lens?: ResearchLens;
    index?: number;
    total?: number;
    subphase?: string;
    primitiveName?: string;
  };

  export type CompanyProfileResult = {
    rootUrl: string;
    modelId: string;
    crawl: { urlCount: number; pages?: unknown[] };
    lenses: ResearchLens[];
    runs: unknown[];
    profile: Record<string, unknown>;
  };

  export type ProfileOptions = {
    modelId?: string;
    model?: unknown;
    maxPages?: number;
    sitemapOnly?: boolean;
    pickOnly?: boolean;
    seedPages?: SeedCatalogPage[];
    hint?: string;
    onLensStart?: (lens: ResearchLens, index: number, total: number) => void;
    onProgress?: (progress: CompanyProfileProgress) => void;
  };

  export function profileSite(
    url: string,
    modes?: ResearchLens[],
    options?: ProfileOptions,
  ): Promise<CompanyProfileResult>;

  export function defaultProfileLenses(): ResearchLens[];
  export function parseResearchLensList(raw: string): ResearchLens[];
  export const researchLensIds: readonly string[];
  export function getLensDefinition(lens: ResearchLens): { label: string };
}
