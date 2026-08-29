import { discoverUrls } from "@ledgeindex/core/crawl/discover.js";
import type { WebCrawlSourceConfig } from "@ledgeindex/core/schemas/source-config.js";
import { DEFAULT_MAX_CRAWL_PAGES } from "@ledgeindex/core/schemas/source-config.js";
import {
  CRAWL_URL_FILTER_LLM_URLS,
  filterCrawlUrls,
} from "@ledgeindex/core/crawl/crawl-url-filter.js";
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

async function selectCatalogPages(input: {
  catalog: SiteCatalogPage[];
  message: string;
  modelId: string;
  model?: ProfileModelSelection | null;
}, reductionRound = 0): Promise<{
  selected: SiteCatalogPage[];
  summary: string;
  modelId: string;
}> {
  async function selectBatch(
    pages: SiteCatalogPage[],
    message: string,
  ): Promise<{ selected: SiteCatalogPage[]; summary: string; modelId: string }> {
    const result = await filterCrawlUrls({
      message,
      urls: pages.map((page, index) => ({
        index,
        url: page.url,
        title: page.title,
      })),
      selectedIndexes: [],
      modelId: input.modelId,
      model: input.model,
    });
    return {
      selected: result.selectedIndexes
        .map((index) => pages[index])
        .filter((page): page is SiteCatalogPage => Boolean(page)),
      summary: result.summary,
      modelId: result.modelId,
    };
  }

  if (input.catalog.length <= CRAWL_URL_FILTER_LLM_URLS) {
    return selectBatch(input.catalog, input.message);
  }

  const batches: SiteCatalogPage[][] = [];
  for (
    let index = 0;
    index < input.catalog.length;
    index += CRAWL_URL_FILTER_LLM_URLS
  ) {
    batches.push(
      input.catalog.slice(index, index + CRAWL_URL_FILTER_LLM_URLS),
    );
  }

  const batchResults = await Promise.all(
    batches.map((batch, index) =>
      selectBatch(
        batch,
        `${input.message}

This is catalog batch ${index + 1} of ${batches.length}. Select relevant candidates from this batch. A final pass will consolidate candidates from every batch.`,
      ),
    ),
  );
  const candidates = [
    ...new Map(
      batchResults
        .flatMap((result) => result.selected)
        .map((page) => [page.url, page]),
    ).values(),
  ];

  if (candidates.length === 0) {
    return {
      selected: [],
      summary: batchResults.map((result) => result.summary).join(" "),
      modelId: batchResults[0]?.modelId ?? input.modelId,
    };
  }

  const consolidationMessage = `${input.message}

These are candidates selected from the full catalog. Consolidate them into the best final set. Preserve coverage of distinct topics named in the user guidance.`;
  if (candidates.length > CRAWL_URL_FILTER_LLM_URLS) {
    if (
      reductionRound >= 3 ||
      candidates.length >= input.catalog.length
    ) {
      throw new Error(
        `Catalog picker did not narrow ${candidates.length} candidates enough for final selection`,
      );
    }
    return selectCatalogPages(
      {
        ...input,
        catalog: candidates,
        message: consolidationMessage,
      },
      reductionRound + 1,
    );
  }

  return selectBatch(candidates, consolidationMessage);
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
  const result = await selectCatalogPages({
    catalog,
    message: `Select the URL(s) from this site catalog needed to answer: ${trimmed}`,
    modelId,
    model: options?.model,
  });

  return {
    query: trimmed,
    modelId: result.modelId,
    selected: result.selected,
    summary: result.summary,
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
    hint?: string;
  },
): Promise<CatalogPickResult> {
  if (catalog.length === 0) {
    throw new Error("catalog is empty — run crawlSiteCatalog first");
  }

  const definition = getLensDefinition(lens);
  const modelId = options?.modelId?.trim() || (await resolveDefaultProfileModelId());

  const hint = options?.hint?.trim();
  const result = await selectCatalogPages({
    catalog,
    message: hint
      ? `${definition.pickMessage}\n\nUser guidance:\n${hint}`
      : definition.pickMessage,
    modelId,
    model: options?.model,
  });

  let selected = result.selected;

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
  };
}
