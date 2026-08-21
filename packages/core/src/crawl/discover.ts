import { randomUUID } from "node:crypto";
import { Log, LogLevel } from "@apify/log";
// Import the cheerio subpackage, not the crawlee meta-package: the latter
// re-exports every crawler, which drags in JSDOM/Playwright/Puppeteer.
import { CheerioCrawler, Configuration } from "@crawlee/cheerio";
import type { WebCrawlSourceConfig } from "../schemas/source-config.js";
import {
  extractMarkdownLinks,
  isMarkdownResponse,
} from "../extract/parser/markdown-alternate.js";
import { extractFirstMarkdownHeading } from "../extract/parser/page-title.js";
import { discoverSitemapUrls, parentScopePathForLandingSeed } from "./sitemap.js";
import { shouldCrawlUrl } from "./url-matcher.js";
import { CanonicalUrlRegistry } from "./canonical-dedupe.js";
import {
  assertHtmlStartUrl,
  isPdfUrl,
} from "../lib/unsupported-start-url.js";
import { filterUrlsByHttpStatus } from "./validate-page-statuses.js";
import {
  isNonSuccessHttpStatus,
  httpStatusSkipReason,
} from "./not-found-page.js";

export type DiscoveredUrl = {
  url: string;
  title?: string;
};

export type SkippedUrl = {
  url: string;
  reason: string;
};

export type DiscoverResult = {
  urls: DiscoveredUrl[];
  skipped: SkippedUrl[];
  /** URLs dropped by the always-on HTTP status cleaner (4xx/5xx/network). */
  httpStatusFiltered?: number;
};

export type DiscoverOptions = {
  sourceId?: string;
  signal?: AbortSignal;
};

export type CrawlProgress = {
  status: "running" | "done";
  /** discovering = sitemap/link crawl; validating = HTTP status cleaner */
  phase?: "discovering" | "validating";
  pagesDiscovered: number;
  maxPages: number;
  validatedCount?: number;
  validationTotal?: number;
  httpErrorCount?: number;
};

const activeCrawls = new Map<string, () => Promise<void>>();
const crawlProgress = new Map<string, CrawlProgress>();

export function getCrawlProgress(sourceId: string): CrawlProgress | null {
  return crawlProgress.get(sourceId) ?? null;
}

function updateCrawlProgress(
  sourceId: string,
  maxPages: number,
  pagesDiscovered: number,
  status: CrawlProgress["status"],
  extra?: Partial<
    Pick<
      CrawlProgress,
      | "phase"
      | "validatedCount"
      | "validationTotal"
      | "httpErrorCount"
    >
  >,
) {
  crawlProgress.set(sourceId, {
    status,
    pagesDiscovered,
    maxPages,
    phase: extra?.phase ?? "discovering",
    validatedCount: extra?.validatedCount,
    validationTotal: extra?.validationTotal,
    httpErrorCount: extra?.httpErrorCount,
  });
}

function clearCrawlProgress(sourceId: string) {
  crawlProgress.delete(sourceId);
}

/** Cap enqueued links per page so huge doc sidebars don't blow the handler budget. */
const MAX_LINKS_PER_PAGE = 500;

async function validateDiscoveredHttpStatuses(args: {
  urls: DiscoveredUrl[];
  skipped: SkippedUrl[];
  config: WebCrawlSourceConfig;
  sourceId?: string;
  signal?: AbortSignal;
  cancelled: () => boolean;
}): Promise<{
  result: DiscoverResult;
  httpStatusFiltered: number;
  validationTotal: number;
}> {
  const {
    urls,
    skipped,
    config,
    sourceId,
    signal,
    cancelled,
  } = args;

  const capped = urls.slice(0, config.maxPages);
  const working = capped;
  // Always re-check every URL with HEAD/GET. Crawlee delivers 404 HTML to
  // requestHandler as a "successful" request, so in-crawl confirmedOk is not enough.
  const toValidate = working;

  if (toValidate.length === 0 || cancelled()) {
    return {
      result: {
        urls: working,
        skipped,
        httpStatusFiltered: 0,
      },
      httpStatusFiltered: 0,
      validationTotal: 0,
    };
  }

  if (sourceId) {
    updateCrawlProgress(sourceId, config.maxPages, working.length, "running", {
      phase: "validating",
      validatedCount: 0,
      validationTotal: toValidate.length,
      httpErrorCount: 0,
    });
  }

  try {
    const filtered = await filterUrlsByHttpStatus(working, {
      userAgent: config.userAgent,
      signal,
      concurrency: 12,
      onProgress: (done, total) => {
        if (!sourceId || cancelled()) return;
        updateCrawlProgress(sourceId, config.maxPages, working.length, "running", {
          phase: "validating",
          validatedCount: done,
          validationTotal: total,
        });
      },
    });

    urls.length = 0;
    urls.push(...filtered.urls);
    skipped.push(...filtered.skipped);

    return {
      result: {
        urls: filtered.urls,
        skipped,
        httpStatusFiltered: filtered.httpStatusFiltered,
      },
      httpStatusFiltered: filtered.httpStatusFiltered,
      validationTotal: toValidate.length,
    };
  } catch (error) {
    if (
      cancelled() ||
      (error instanceof Error && error.name === "AbortError")
    ) {
      return {
        result: {
          urls: working,
          skipped,
          httpStatusFiltered: 0,
        },
        httpStatusFiltered: 0,
        validationTotal: toValidate.length,
      };
    }
    throw error;
  }
}

/**
 * Start URLs plus parent scopes (`/docs/intro` → also `/docs`,
 * `/components/attachments` → also `/components`).
 * Keeps sitemap filtering and link-following inside each start section.
 */
function crawlScopeStartUrls(startUrls: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const url of startUrls) {
    const key = url.replace(/\/$/, "");
    if (!seen.has(key)) {
      seen.add(key);
      out.push(url);
    }
    const parent = parentScopePathForLandingSeed(url);
    if (!parent) continue;
    const parentKey = parent.replace(/\/$/, "");
    if (seen.has(parentKey)) continue;
    seen.add(parentKey);
    out.push(parent);
  }
  return out;
}

/** Build Crawlee globs so link-following stays within the start URL path. */
function buildLinkEnqueueGlobs(startUrls: string[]): string[] {
  const globs = new Set<string>();

  for (const startUrl of startUrls) {
    try {
      const parsed = new URL(startUrl);
      const path = parsed.pathname.replace(/\/+$/, "") || "/";
      if (path === "/") {
        globs.add(`${parsed.origin}/**`);
      } else {
        globs.add(`${parsed.origin}${path}`);
        globs.add(`${parsed.origin}${path}/**`);
      }
    } catch {
      // ignore invalid start URLs
    }
  }

  return [...globs];
}

function createEnqueueTransform(
  config: WebCrawlSourceConfig,
  scopeStartUrls: string[],
  skipped: SkippedUrl[],
  registry: CanonicalUrlRegistry,
) {
  return function transformRequest(req: { url: string }) {
    if (registry.hasExact(req.url)) {
      // Already listed (e.g. from sitemap) — don't fetch again.
      return false;
    }

    const decision = shouldCrawlUrl(req.url, {
      startUrls: scopeStartUrls,
      includePatterns: config.includePatterns,
      excludePatterns: config.excludePatterns,
      excludeDownloadPatterns: config.excludeDownloadPatterns,
      patternsAreRegex: config.patternsAreRegex,
    });
    if (!decision.allowed) {
      // Out-of-scope links are filtered by enqueue globs; no need to log each one.
      if (!decision.reason?.includes("scope")) {
        skipped.push({
          url: req.url,
          reason: decision.reason ?? "Skipped",
        });
      }
      return false;
    }
    return req;
  };
}

export function cancelDiscoverCrawl(sourceId: string): boolean {
  const stop = activeCrawls.get(sourceId);
  if (!stop) return false;
  void stop();
  return true;
}

function createCrawlConfiguration() {
  // Each discovery run needs its own in-memory request queue. Reusing the
  // global "default" queue marks seed URLs as already handled on the 2nd run.
  //
  // Crawlee 3.17 enables systemInfoV2 by default. On Windows its PowerShell
  // process parser throws on truncated Format-Table headers (WorkingSetSi).
  // On Linux both v1 and v2 spawn `ps` for memory metrics — Cloud Run needs
  // procps in the API image (see ledgeindex-api/Dockerfile).
  return new Configuration({
    persistStorage: false,
    purgeOnStart: true,
    defaultRequestQueueId: randomUUID(),
    systemInfoV2: false,
  });
}

export async function discoverUrls(
  config: WebCrawlSourceConfig,
  options?: DiscoverOptions,
): Promise<DiscoverResult> {
  for (const startUrl of config.startUrls) {
    assertHtmlStartUrl(startUrl);
  }

  const crawlConfig = createCrawlConfiguration();

  const urls: DiscoveredUrl[] = [];
  const skipped: SkippedUrl[] = [];
  const registry = new CanonicalUrlRegistry(urls, skipped, config.maxPages);
  const failedFetchUrls = new Set<string>();
  let cancelled = false;
  const sourceId = options?.sourceId;

  const syncProgress = (
    status: CrawlProgress["status"] = "running",
    extra?: Partial<
      Pick<
        CrawlProgress,
        | "phase"
        | "validatedCount"
        | "validationTotal"
        | "httpErrorCount"
      >
    >,
  ) => {
    if (!sourceId) return;
    updateCrawlProgress(sourceId, config.maxPages, urls.length, status, {
      phase: "discovering",
      ...extra,
    });
  };

  if (sourceId) {
    updateCrawlProgress(sourceId, config.maxPages, 0, "running", {
      phase: "discovering",
    });
  }

  const scopeStartUrls = crawlScopeStartUrls(config.startUrls);

  const recordUrl = (url: string, title?: string) => {
    if (registry.hasExact(url)) return;
    if (urls.length >= config.maxPages) return;

    const decision = shouldCrawlUrl(url, {
      startUrls: scopeStartUrls,
      includePatterns: config.includePatterns,
      excludePatterns: config.excludePatterns,
      excludeDownloadPatterns: config.excludeDownloadPatterns,
      patternsAreRegex: config.patternsAreRegex,
    });
    if (!decision.allowed) {
      registry.markSeenExact(url);
      skipped.push({ url, reason: decision.reason ?? "Skipped" });
      return;
    }

    if (registry.tryRecord(url, title)) {
      syncProgress();
    }
  };

  for (const url of config.startUrls) {
    recordUrl(url);
  }

  let sitemapFound = false;
  if (config.enableSitemap) {
    const sitemapUrls = await discoverSitemapUrls(
      config.startUrls,
      config.sitemapUrls,
      config.userAgent,
    );
    sitemapFound = sitemapUrls.length > 0;
    for (const url of sitemapUrls) {
      recordUrl(url);
    }
  }

  syncProgress();

  if (config.sitemapOnly && config.enableSitemap && sitemapFound) {
    const validated = await validateDiscoveredHttpStatuses({
      urls,
      skipped,
      config,
      sourceId,
      signal: options?.signal,
      cancelled: () => cancelled || Boolean(options?.signal?.aborted),
    });
    if (sourceId) {
      syncProgress("done", {
        phase: "validating",
        httpErrorCount: validated.httpStatusFiltered,
        validatedCount: validated.validationTotal,
        validationTotal: validated.validationTotal,
      });
      setTimeout(() => clearCrawlProgress(sourceId), 60_000);
    }
    return validated.result;
  }

  const linkGlobs = buildLinkEnqueueGlobs(scopeStartUrls);
  const enqueueTransform = createEnqueueTransform(
    config,
    scopeStartUrls,
    skipped,
    registry,
  );

  const crawler = new CheerioCrawler(
    {
      maxRequestsPerCrawl: config.maxPages,
      maxConcurrency: 4,
      maxRequestRetries: 1,
      navigationTimeoutSecs: 45,
      requestHandlerTimeoutSecs: 60,
      additionalMimeTypes: [
        "text/html",
        "application/xhtml+xml",
        "text/markdown",
      ],
      // Crawlee Log ESM/CJS types diverge under some workspace resolutions.
      log: new Log({ level: LogLevel.WARNING }) as never,
      preNavigationHooks: [
        async ({ request }) => {
          request.headers = {
            ...request.headers,
            "User-Agent": config.userAgent,
          };
        },
      ],
      async requestHandler({
        request,
        response,
        $,
        enqueueLinks,
        contentType,
        body,
      }) {
        if (cancelled || urls.length >= config.maxPages) {
          return;
        }

        if (isPdfUrl(request.url)) {
          skipped.push({
            url: request.url,
            reason: "PDF URLs are not supported",
          });
          return;
        }

        // Crawlee treats many 4xx HTML responses as finished requests (not
        // failedRequestHandler). Check HTTP status before recording the URL.
        const statusCode =
          typeof response?.statusCode === "number" ? response.statusCode : null;

        if (isNonSuccessHttpStatus(statusCode)) {
          failedFetchUrls.add(request.url);
          if (request.loadedUrl) failedFetchUrls.add(request.loadedUrl);
          skipped.push({
            url: request.url,
            reason: httpStatusSkipReason(statusCode!),
          });
          syncProgress();
          return;
        }

        const bodyText = typeof body === "string" ? body : "";
        const canParseHtml = typeof $ === "function";
        const title = canParseHtml
          ? $("title").first().text().trim() || undefined
          : undefined;

        const isMarkdown = isMarkdownResponse(contentType, bodyText);

        const linkEnqueueOptions = {
          globs: linkGlobs,
          exclude: [{ glob: "**/*.txt" }, { glob: "**/*.pdf" }],
          limit: MAX_LINKS_PER_PAGE,
          transformRequestFunction: enqueueTransform,
        } as const;

        if (isMarkdown) {
          const mdTitle = extractFirstMarkdownHeading(bodyText) || undefined;
          recordUrl(request.url, mdTitle);

          if (urls.length >= config.maxPages) {
            return;
          }

          const markdownLinks = extractMarkdownLinks(bodyText, request.url);
          if (markdownLinks.length > 0) {
            await enqueueLinks({
              urls: markdownLinks.slice(0, MAX_LINKS_PER_PAGE),
              ...linkEnqueueOptions,
            });
          }
          return;
        }

        recordUrl(request.url, title);

        if (urls.length >= config.maxPages || !canParseHtml) {
          return;
        }

        await enqueueLinks(linkEnqueueOptions);
      },
      failedRequestHandler({ request }, error) {
        const message =
          error instanceof Error ? error.message : "Request failed";
        failedFetchUrls.add(request.url);
        if (request.loadedUrl) failedFetchUrls.add(request.loadedUrl);
        const statusMatch = message.match(/\b([45]\d\d)\b/);
        skipped.push({
          url: request.url,
          reason: statusMatch
            ? `HTTP ${statusMatch[1]}`
            : `Request failed: ${message}`,
        });
        syncProgress();
      },
    },
    crawlConfig,
  );

  const stop = async () => {
    cancelled = true;
    syncProgress("done");
    try {
      await crawler.teardown();
    } catch {
      // Ignore teardown races when the crawl already finished.
    }
  };

  if (sourceId) {
    activeCrawls.set(sourceId, stop);
  }

  const onAbort = () => {
    void stop();
  };
  options?.signal?.addEventListener("abort", onAbort);

  try {
    await crawler.run([...config.startUrls]);
  } catch (error) {
    if (!cancelled && !options?.signal?.aborted) {
      throw error;
    }
  } finally {
    options?.signal?.removeEventListener("abort", onAbort);
    if (sourceId) {
      activeCrawls.delete(sourceId);
    }
  }

  if (cancelled || options?.signal?.aborted) {
    if (sourceId) {
      syncProgress("done");
      setTimeout(() => clearCrawlProgress(sourceId), 60_000);
    }
    return {
      urls: urls
        .filter((item) => !failedFetchUrls.has(item.url))
        .slice(0, config.maxPages),
      skipped,
      httpStatusFiltered: 0,
    };
  }

  // Drop URLs that failed during link-following (kept in the list until now
  // so the canonical registry index stayed stable mid-crawl).
  if (failedFetchUrls.size > 0) {
    const kept = urls.filter((item) => !failedFetchUrls.has(item.url));
    urls.length = 0;
    urls.push(...kept);
  }

  const validated = await validateDiscoveredHttpStatuses({
    urls,
    skipped,
    config,
    sourceId,
    signal: options?.signal,
    cancelled: () => cancelled || Boolean(options?.signal?.aborted),
  });

  if (sourceId) {
    syncProgress("done", {
      phase: "validating",
      httpErrorCount: validated.httpStatusFiltered,
      validatedCount: validated.validationTotal,
      validationTotal: validated.validationTotal,
    });
    setTimeout(() => clearCrawlProgress(sourceId), 60_000);
  }

  return validated.result;
}
