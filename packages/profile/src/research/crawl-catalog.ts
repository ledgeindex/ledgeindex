import { discoverUrls } from "@ledgeindex/core/crawl/discover.js";
import type { WebCrawlSourceConfig } from "@ledgeindex/core/schemas/source-config.js";
import { DEFAULT_MAX_CRAWL_PAGES } from "@ledgeindex/core/schemas/source-config.js";
import { filterCrawlUrls } from "@ledgeindex/core/crawl/crawl-url-filter.js";
import {
  GEMINI_3_5_FLASH_LITE_CATALOG_ID,
  resolveDefaultProfileModelId,
} from "@ledgeindex/core/llm/chat-model-config.js";
import { getLensDefinition, type ResearchLens } from "./research-lenses.js";
import type { ProfileModelSelection } from "./profile-model.js";
import { applyCatalogPickFallback } from "./catalog-pick-fallback.js";

export type SiteCatalogPage = {
  url: string;
  title: string;
};

export type CrawlSiteCatalogInput = {
  rootUrl: string;
  maxPages?: number;
  /** Faster: use sitemap URLs only when a sitemap exists. */
  sitemapOnly?: boolean;
  userAgent?: string;
};

export type CrawlSiteCatalogResult = {
  rootUrl: string;
  urlCount: number;
  skippedCount: number;
  pages: SiteCatalogPage[];
};

export type CatalogPickResult = {
  query: string;
  modelId: string;
  selected: SiteCatalogPage[];
  summary: string;
  truncated?: boolean;
  totalUrls?: number;
  lens?: ResearchLens;
  /** True when heuristic/root fallback ran after an empty LLM pick. */
  pickFallback?: boolean;
};

const DEFAULT_USER_AGENT = "LedgeIndexCompanyBot/1.0";
/** Preferred cloud default when no keys are inspected (scripts / docs). */
export const DEFAULT_CATALOG_PICK_MODEL = GEMINI_3_5_FLASH_LITE_CATALOG_ID;

function normalizeRoot(rootUrl: string): string {
  const trimmed = rootUrl.trim();
  if (!trimmed) throw new Error("rootUrl is required");
  return trimmed.endsWith("/") ? trimmed : `${trimmed}/`;
}

/**
 * Crawl → catalog (URLs + titles). Primitive: @ledgeindex/core `discoverUrls`.
 */
export async function crawlSiteCatalog(
  input: CrawlSiteCatalogInput,
): Promise<CrawlSiteCatalogResult> {
  const rootUrl = normalizeRoot(input.rootUrl);
  const maxPages = input.maxPages ?? DEFAULT_MAX_CRAWL_PAGES;

  const config: WebCrawlSourceConfig = {
    startUrls: [rootUrl],
    includePatterns: [],
    excludePatterns: [],
    excludeDownloadPatterns: [],
    patternsAreRegex: false,
    renderJs: false,
    useProxy: false,
    enableSitemap: true,
    sitemapOnly: input.sitemapOnly ?? false,
    sitemapUrls: [],
    fileTypes: ["html"],
    contentSelectors: [],
    excludeSelectors: [],
    maxPages,
    userAgent: input.userAgent ?? DEFAULT_USER_AGENT,
  };

  const { urls, skipped } = await discoverUrls(config);

  const pages: SiteCatalogPage[] = urls.map((entry) => ({
    url: entry.url,
    title: entry.title?.trim() || entry.url,
  }));

  return {
    rootUrl,
    urlCount: pages.length,
    skippedCount: skipped.length,
    pages,
  };
}

/**
 * Catalog picker: LLM selects indexes from the crawled URL list.
 * Primitive: @ledgeindex/core `filterCrawlUrls` (same as docs crawl filter UI).
 *
 * Default model is key-aware (Gemini → OpenAI → DeepSeek; LM Studio last).
 */
export async function pickCatalogForQuery(
  catalog: SiteCatalogPage[],
  query: string,
  options?: {
    modelId?: string;
    model?: ProfileModelSelection | null;
  },
): Promise<CatalogPickResult> {
  const trimmed = query.trim();
  if (!trimmed) throw new Error("query is required");
  if (catalog.length === 0) {
    throw new Error("catalog is empty — run crawlSiteCatalog first");
  }

  const modelId = options?.modelId?.trim() || (await resolveDefaultProfileModelId());
  const entries = catalog.map((page, index) => ({
    index,
    url: page.url,
    title: page.title,
  }));

  const result = await filterCrawlUrls({
    message: `Select the URL(s) from this site catalog needed to answer: ${trimmed}`,
    urls: entries,
    selectedIndexes: [],
    modelId,
    model: options?.model,
  });

  const selected = result.selectedIndexes
    .map((i) => catalog[i])
    .filter((p): p is SiteCatalogPage => Boolean(p));

  return {
    query: trimmed,
    modelId: result.modelId,
    selected,
    summary: result.summary,
    ...(result.truncated ? { truncated: true, totalUrls: result.totalUrls } : {}),
  };
}

/**
 * Catalog picker for a fixed research lens (stable pick message per mode).
 */
export async function pickCatalogForLens(
  catalog: SiteCatalogPage[],
  lens: ResearchLens,
  options?: {
    modelId?: string;
    model?: ProfileModelSelection | null;
    rootUrl?: string;
  },
): Promise<CatalogPickResult> {
  if (catalog.length === 0) {
    throw new Error("catalog is empty — run crawlSiteCatalog first");
  }

  const definition = getLensDefinition(lens);
  const modelId = options?.modelId?.trim() || (await resolveDefaultProfileModelId());
  const entries = catalog.map((page, index) => ({
    index,
    url: page.url,
    title: page.title,
  }));

  const result = await filterCrawlUrls({
    message: definition.pickMessage,
    urls: entries,
    selectedIndexes: [],
    modelId,
    model: options?.model,
  });

  let selected = result.selectedIndexes
    .map((i) => catalog[i])
    .filter((p): p is SiteCatalogPage => Boolean(p));

  let summary = result.summary;
  let pickFallback = false;
  const rootUrl = options?.rootUrl?.trim();
  if (selected.length === 0 && rootUrl) {
    const fallback = applyCatalogPickFallback({
      lens,
      catalog,
      rootUrl,
      selected,
    });
    selected = fallback.selected;
    pickFallback = fallback.usedFallback;
    if (fallback.fallbackSummary) {
      summary = summary
        ? `${summary} ${fallback.fallbackSummary}`
        : fallback.fallbackSummary;
    }
  }

  return {
    query: `lens:${lens}`,
    lens,
    modelId: result.modelId,
    selected,
    summary,
    ...(pickFallback ? { pickFallback: true } : {}),
    ...(result.truncated ? { truncated: true, totalUrls: result.totalUrls } : {}),
  };
}
