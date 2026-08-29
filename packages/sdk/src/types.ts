import type { RerankBackend } from "@ledgeindex/core/query/rerank-backend.js";
import type { VectorBackend } from "@ledgeindex/core/vector/config.js";
import type {
  SourceCorpusExport,
  SourceCorpusExportOptions,
  WrittenSourceCorpus,
} from "@ledgeindex/core/export/source-corpus.js";
import type { RepoIndexProgress } from "@ledgeindex/repo";
import type { CompanyProfileResult } from "./profile.js";
import type { SourceAskResult } from "@ledgeindex/docs/runtime/services/source-ask.js";
import type { RoutedAskResult } from "@ledgeindex/docs/runtime/services/routed-ask.js";
import type { CrawlProgressUpdate, RunWebCrawlResult } from "./crawl.js";
import type { LedgeIndexProfileOptions } from "./profile.js";
import type { ProfileIndexedSourceOptions } from "./profile-indexed-source.js";
import type {
  ApplyUpdatesOptions,
  ApplyUpdatesResult,
  CheckForUpdatesOptions,
  CheckForUpdatesResult,
} from "./refresh.js";

export type ChatProvider = "google" | "openai" | "deepseek";

export type LedgeIndexKeys = {
  openai?: string;
  google?: string;
  deepseek?: string;
  cohere?: string;
};

export type LedgeIndexOptions = {
  /** Default `~/.ledgeindex/data` */
  dataDir?: string;
  /** Owner id for personal sources (default `ledgeindex-sdk-local`). */
  localUserId?: string;
  keys?: LedgeIndexKeys;
  /** Chat/crawl LLM provider. Omit for auto: google → deepseek → openai. */
  provider?: ChatProvider;
  /**
   * `libsql` — FastEmbed (384-d) + LibSQL file (default).
   * `pgvector` — Gemini embeddings (1536-d) + Postgres; requires `postgresUrl` + Google key.
   */
  vectorBackend?: VectorBackend;
  /** Writable Postgres URL. Sets `POSTGRES_CONNECTION_STRING`. */
  postgresUrl?: string;
  /**
   * Rerank on ask/crawl retrieve. Defaults to `cohere` when Cohere key is set, else `local`.
   * Use `cohere-auto` or `local-auto` for escalation (same as web UI).
   */
  rerankBackend?: RerankBackend;
};

export type SourceSummary = {
  id: string;
  name: string;
  slug: string;
};

export type LedgeIndexAskOptions = {
  rerankBackend?: RerankBackend;
  provider?: ChatProvider;
  /** `retrieve-only` skips the agent — hits only, no chat key required. */
  mode?: "agent" | "retrieve-only";
  /** strict | balanced (weak fallback) | permissive (lower threshold + weak). */
  retrievalStrictness?: "strict" | "balanced" | "permissive";
  /** Override prune threshold (0–1). `null` disables pruning. */
  relevanceThreshold?: number | null;
  /** Include below-threshold rerank hits when strict pruning finds nothing. */
  includeWeakEvidence?: boolean;
};

export type LedgeIndexAskAcrossSourceMode = "picker" | "all";

export type LedgeIndexAskAcrossOptions = {
  /** Slugs (or ids) the picker may choose from — e.g. a repo and its docs. */
  sources?: string[];
  /** Saved source set to choose within, instead of listing slugs per call. */
  sourceSet?: string;
  /**
   * `picker` (default) — LLM picks which allowed sources to read.
   * `all` — always retrieve from every allowed source.
   */
  sourceMode?: LedgeIndexAskAcrossSourceMode;
  rerankBackend?: RerankBackend;
  provider?: ChatProvider;
};

export type LedgeIndexSourceSet = {
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

export type LedgeIndexSaveSourceSetOptions = {
  name: string;
  /** Defaults to a slug of `name`. Saving the same slug again updates the set. */
  slug?: string;
  description?: string | null;
  /** Source slugs or ids to pin — e.g. a repo and its docs. */
  sources: string[];
};

/** Optional overrides merged into the default web crawl config. */
export type LedgeIndexCrawlConfigOverrides = {
  includePatterns?: string[];
  excludePatterns?: string[];
  excludeDownloadPatterns?: string[];
  patternsAreRegex?: boolean;
  renderJs?: boolean;
  enableSitemap?: boolean;
  sitemapOnly?: boolean;
  contentSelectors?: string[];
  excludeSelectors?: string[];
  fileTypes?: string[];
};

export type LedgeIndexCrawlOptions = {
  url: string;
  name?: string;
  /** Optional source slug; defaults to preflight site slug. */
  slug?: string;
  maxPages?: number;
  /**
   * LLM URL cleanup after crawl. Default `false` — crawl + index does not need a chat model.
   * Set `true` to run AI filter (requires google, openai, or deepseek key).
   */
  autoFilter?: boolean;
  /**
   * After preflight, scan the site header for sibling docs sections (guides, reference, …)
   * and add them as extra start URLs. Uses Stagehand + a chat model key (same as web UI).
   */
  discoverHeaderNav?: boolean;
  /** Example enrichment during ingest. Default `false`. Requires a chat model key. */
  enrichExamples?: boolean;
  scope?: "personal" | "global";
  /** Merged into the generated crawl config (patterns, selectors, renderJs, …). */
  crawlConfig?: LedgeIndexCrawlConfigOverrides;
  onProgress?: (update: CrawlProgressUpdate) => void;
};

export type LedgeIndexIndexRepoOptions = {
  /** Clone from GitHub (or use with checkoutPath for metadata). */
  githubUrl?: string;
  /** Index a local checkout instead of cloning. */
  checkoutPath?: string;
  /** Source display name / slug base. Default: owner/repo from githubUrl. */
  name?: string;
  /** Re-index an existing source by slug or id instead of matching on name. */
  source?: string;
  ref?: string;
  /** Opt back into test/eval/fixture files (excluded by default). */
  includeTests?: boolean;
  /** Opt back into .md / .mdx (README, changelogs, etc.) — excluded by default. */
  includeReadme?: boolean;
  /**
   * Optional extension filter — only index these types (subset of the default
   * JS/TS allowlist). Accepts `"ts"` or `".tsx"`. Markdown still needs
   * `includeReadme: true`.
   */
  extensions?: string[];
  maxFiles?: number;
  onProgress?: (progress: RepoIndexProgress) => void;
};

export type LedgeIndexIndexRepoProgress = RepoIndexProgress;

export type LedgeIndexIndexRepoResult = {
  sourceId: string;
  slug: string;
  name: string;
  fileCount: number;
  pageCount: number;
  chunkCount: number;
  astChunkedFiles: number;
  astFallbackFiles: number;
  exportedSymbolCount: number;
  checkoutPath: string;
  commitSha?: string;
};

export type LedgeIndex = {
  readonly dataDir: string;
  readonly localUserId: string;
  crawl(options: LedgeIndexCrawlOptions): Promise<RunWebCrawlResult>;
  indexRepo(options: LedgeIndexIndexRepoOptions): Promise<LedgeIndexIndexRepoResult>;
  ask(
    sourceIdOrSlug: string,
    question: string,
    options?: LedgeIndexAskOptions,
  ): Promise<SourceAskResult>;
  /**
   * Ask across sources and let a picker choose which to read — a repo, its
   * docs, or both. Requires a chat model key.
   */
  askAcross(
    question: string,
    options?: LedgeIndexAskAcrossOptions,
  ): Promise<RoutedAskResult>;
  listSources(): Promise<SourceSummary[]>;
  /** Sets pin which sources a routed ask may choose from. */
  listSourceSets(): Promise<LedgeIndexSourceSet[]>;
  /** Create or update a set by slug. */
  saveSourceSet(
    options: LedgeIndexSaveSourceSetOptions,
  ): Promise<LedgeIndexSourceSet>;
  resolveSource(
    token: string,
  ): Promise<{ sourceId: string; name: string; slug: string }>;
  /** Site research profile — requires a chat model key. Does not use the index store. */
  profile(
    url: string,
    options?: LedgeIndexProfileOptions,
  ): Promise<CompanyProfileResult>;
  /** Profile an indexed source from stored page content without crawling it again. */
  profileIndexedSource(
    sourceIdOrSlug: string,
    options?: ProfileIndexedSourceOptions,
  ): Promise<CompanyProfileResult>;
  /** Compare indexed pages to live content — new, updated, and removed pages. */
  checkForUpdates(
    options: CheckForUpdatesOptions,
  ): Promise<CheckForUpdatesResult>;
  /** Re-index after {@link checkForUpdates}. */
  applyUpdates(options: ApplyUpdatesOptions): Promise<ApplyUpdatesResult>;
  /** Remove a source and all its vectors, lexical rows, and catalog data. */
  deleteSource(
    sourceIdOrSlug: string,
  ): Promise<{ deleted: boolean; sourceId: string }>;
  /** Export the exact indexed corpus as a versioned JSON structure. */
  exportCorpus(
    sourceIdOrSlug: string,
    options?: SourceCorpusExportOptions,
  ): Promise<SourceCorpusExport>;
  /** Export one Markdown file per indexed page plus manifest.json. */
  exportCorpusToDirectory(
    sourceIdOrSlug: string,
    outputDirectory: string,
    options?: SourceCorpusExportOptions,
  ): Promise<WrittenSourceCorpus>;
};

export type ResolvedLedgeIndexOptions = {
  dataDir: string;
  localUserId: string;
  provider?: ChatProvider;
  keys: LedgeIndexKeys;
  vectorBackend: VectorBackend;
  postgresUrl?: string;
  rerankBackend?: RerankBackend;
};
