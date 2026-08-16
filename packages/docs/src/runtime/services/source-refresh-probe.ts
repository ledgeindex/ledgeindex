import { discoverSitemapUrls } from "@ledgeindex/core/crawl/sitemap.js";
import {
  headersIndicateChange,
  probePageHeaders,
} from "@ledgeindex/core/crawl/probe-page-headers.js";
import { shouldCrawlUrl } from "@ledgeindex/core/crawl/url-matcher.js";
import type { Source } from "@ledgeindex/core/db/types.js";
import {
  listPageSnapshots,
  type PageSnapshotInput,
} from "../db/page-snapshots.js";
import {
  listPageProbeHeaders,
  mergePageProbeHeaders,
  type PageProbeHeaders,
} from "../db/page-probe-headers.js";
import { getStore } from "../db/index.js";
import { mapWithConcurrency } from "../lib/map-with-concurrency.js";
import { logInfo } from "../lib/logger.js";
import {
  assertRefreshNotCancelled,
  patchRefreshRun,
  type RefreshChangelog,
  type RefreshRunSnapshot,
} from "../refresh/active-refresh-runs.js";
import { ensureCatalogHasPages } from "../retrieval/page-catalog-rebuild.js";

const PROBE_CONCURRENCY = Math.max(
  1,
  Number(process.env.LEDGEINDEX_PROBE_CONCURRENCY ?? 12) || 12,
);

function titleFromUrl(url: string): string {
  try {
    const path = new URL(url).pathname.replace(/\/+$/, "") || "/";
    const segment = path.split("/").filter(Boolean).pop();
    return segment ? decodeURIComponent(segment) : url;
  } catch {
    return url;
  }
}

function filterSitemapUrls(source: Source, urls: string[]): string[] {
  const maxPages = source.config.maxPages;
  const allowed: string[] = [];

  for (const url of urls) {
    if (allowed.length >= maxPages) break;
    const decision = shouldCrawlUrl(url, {
      startUrls: source.config.startUrls,
      includePatterns: source.config.includePatterns,
      excludePatterns: source.config.excludePatterns,
      excludeDownloadPatterns: source.config.excludeDownloadPatterns,
      patternsAreRegex: source.config.patternsAreRegex,
    });
    if (decision.allowed) {
      allowed.push(url);
    }
  }

  return allowed;
}

export async function runProbeRefreshCheck(
  sourceId: string,
  run: RefreshRunSnapshot,
) {
  const source = await getStore().getSource(sourceId);
  if (!source) {
    throw new Error("Source not found");
  }

  const catalog = await ensureCatalogHasPages(sourceId);
  const indexedPages =
    catalog?.pages
      .map((page) => ({ url: page.url, title: page.title || page.url }))
      .filter((page) => page.url) ?? [];

  if (indexedPages.length === 0) {
    throw new Error("No indexed pages found in catalog");
  }

  const indexedByUrl = new Map(
    indexedPages.map((page) => [page.url, page] as const),
  );
  const existingSnapshots = await listPageSnapshots(sourceId);
  const snapshotByUrl = new Map(
    existingSnapshots.map((page) => [page.url, page] as const),
  );
  const storedHeaders = listPageProbeHeaders(sourceId);

  let sitemapUrls: string[] = [];

  if (source.config.enableSitemap !== false) {
    patchRefreshRun(sourceId, {
      status: "discovering",
      phase: "discovering",
      current: 0,
      total: 1,
      activePath: "sitemap",
    });

    assertRefreshNotCancelled(sourceId);

    const discovered = await discoverSitemapUrls(
      source.config.startUrls,
      source.config.sitemapUrls ?? [],
      source.config.userAgent,
    );
    sitemapUrls = filterSitemapUrls(source, discovered);
  }

  const addedFromSitemap = sitemapUrls
    .filter((url) => !indexedByUrl.has(url))
    .map((url) => ({
      url,
      title: titleFromUrl(url),
    }));

  const probeTotal = indexedPages.length;
  patchRefreshRun(sourceId, {
    status: "parsing",
    phase: "parsing",
    current: 0,
    total: probeTotal,
    activePath: undefined,
  });

  const headerUpdates: Record<string, PageProbeHeaders> = {};
  const removed: Array<{ url: string; title: string }> = [];
  const updated: Array<{ url: string; title: string }> = [];
  let unchangedCount = 0;
  let baselineCapturedCount = 0;

  await mapWithConcurrency(
    indexedPages,
    PROBE_CONCURRENCY,
    async (page) => {
      assertRefreshNotCancelled(sourceId);
      const prior = storedHeaders[page.url];
      const result = await probePageHeaders(
        page.url,
        source.config.userAgent,
        {
          etag: prior?.etag,
          lastModified: prior?.lastModified,
        },
      );

      if (!result.ok) {
        if (result.status === 404 || result.status === 410) {
          removed.push({ url: page.url, title: page.title });
        } else {
          unchangedCount += 1;
        }
        return;
      }

      const change = headersIndicateChange({
        storedEtag: prior?.etag,
        storedLastModified: prior?.lastModified,
        etag: result.etag,
        lastModified: result.lastModified,
        notModified: result.notModified,
      });

      if (change.baselineCaptured) {
        baselineCapturedCount += 1;
      }

      if (change.changed) {
        updated.push({ url: page.url, title: page.title });
      } else {
        unchangedCount += 1;
      }

      const nextHeaders: PageProbeHeaders = {};
      if (result.etag) nextHeaders.etag = result.etag;
      if (result.lastModified) nextHeaders.lastModified = result.lastModified;
      if (Object.keys(nextHeaders).length > 0) {
        headerUpdates[page.url] = nextHeaders;
      }
    },
    {
      onItemComplete: (completed, total) => {
        patchRefreshRun(sourceId, {
          status: "parsing",
          phase: "parsing",
          current: completed,
          total,
        });
      },
    },
  );

  if (Object.keys(headerUpdates).length > 0) {
    mergePageProbeHeaders(sourceId, headerUpdates);
  }

  assertRefreshNotCancelled(sourceId);

  patchRefreshRun(sourceId, {
    status: "comparing",
    phase: "comparing",
    current: probeTotal,
    total: probeTotal,
  });

  const changelog: RefreshChangelog = {
    baselineCaptured: baselineCapturedCount > 0 && addedFromSitemap.length === 0 &&
      updated.length === 0 &&
      removed.length === 0,
    unchangedCount,
    added: addedFromSitemap,
    updated,
    removed,
  };

  const pendingSnapshots: PageSnapshotInput[] = [];

  for (const page of indexedPages) {
    if (removed.some((entry) => entry.url === page.url)) continue;
    const prior = snapshotByUrl.get(page.url);
    pendingSnapshots.push({
      url: page.url,
      title: page.title,
      contentHash: prior?.contentHash ?? "",
    });
  }

  for (const page of addedFromSitemap) {
    pendingSnapshots.push({
      url: page.url,
      title: page.title,
      contentHash: "",
    });
  }

  patchRefreshRun(sourceId, {
    status: "ready",
    phase: "done",
    current: probeTotal + addedFromSitemap.length,
    total: probeTotal + addedFromSitemap.length,
    changelog,
    pendingSnapshots,
    parsedPagesCache: {},
  });

  logInfo("Probe refresh check completed", "SourceRefreshProbe", {
    sourceId,
    runId: run.runId,
    sitemapUrls: sitemapUrls.length,
    added: changelog.added.length,
    updated: changelog.updated.length,
    removed: changelog.removed.length,
    unchangedCount: changelog.unchangedCount,
    baselineCaptured: changelog.baselineCaptured,
  });
}
