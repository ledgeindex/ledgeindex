import type { Source } from "@ledgeindex/core/db/types.js";
import { discoverUrls, getCrawlProgress } from "../crawler/discover.js";
import { getStore } from "../db/index.js";
import {
  hashPageContent,
  listPageSnapshots,
  syncPageSnapshotHashes,
  tombstonePageSnapshots,
  type PageSnapshotInput,
} from "../db/page-snapshots.js";
import { runProbeRefreshCheck } from "./source-refresh-probe.js";
import {
  INDEXED_CONTENT_HASH_PREFIX,
  buildRefreshChangelog,
  pageRefreshUrlKey,
  refreshDeleteUrls,
} from "./refresh-changelog.js";
import { cancelIngestForSource } from "../ingest/ingest-cancel.js";
import {
  prepareChunksForPages,
  storePreparedChunks,
} from "../indexing/index-chunks.js";
import { markSourceIndexed } from "../indexing/source-index-status.js";
import { mapWithConcurrency } from "../lib/map-with-concurrency.js";
import { logError, logInfo } from "../lib/logger.js";
import { parsePage } from "../parser/extract-content.js";
import { deleteLexicalChunks } from "../retrieval/lexical-store.js";
import { ensureCatalogHasPages, rebuildFullCatalogFromVector } from "../retrieval/page-catalog-rebuild.js";
import {
  getMetadataCatalog,
  saveMetadataCatalog,
} from "../retrieval/metadata-catalog-store.js";
import { LEDGEINDEX_CHUNKS_INDEX } from "../vector/constants.js";
import { ensureChunksIndex, getVectorStore } from "../vector/store.js";
import {
  assertRefreshNotCancelled,
  clearRefreshRun,
  createRefreshRun,
  getActiveRefreshRun,
  listRefreshRuns,
  patchRefreshRun,
  requestRefreshCancellation,
  canReuseRefreshRun,
  type RefreshMode,
  type RefreshRunSnapshot,
} from "../refresh/active-refresh-runs.js";

const REFRESH_PARSE_CONCURRENCY = Math.max(
  1,
  Number(process.env.LEDGEINDEX_EXTRACT_CONCURRENCY ?? 8) || 8,
);

function hashForRefresh(markdown: string): string {
  return `${INDEXED_CONTENT_HASH_PREFIX}${hashPageContent(markdown)}`;
}

function pathLabelFromStartUrl(url: string): string {
  try {
    return new URL(url).pathname.replace(/\/+$/, "") || "/";
  } catch {
    return url;
  }
}

function startRefreshDiscoverProgressSync(
  sourceId: string,
  meta: {
    activePath?: string;
    pathIndex?: number;
    pathTotal?: number;
    pagesAlreadyDiscovered: number;
    maxPages: number;
  },
) {
  const tick = () => {
    const progress = getCrawlProgress(sourceId);
    const pathPages = progress?.pagesDiscovered ?? 0;
    patchRefreshRun(sourceId, {
      status: "discovering",
      phase: "discovering",
      current: Math.min(
        meta.maxPages,
        meta.pagesAlreadyDiscovered + pathPages,
      ),
      total: meta.maxPages,
      activePath: meta.activePath,
      pathIndex: meta.pathIndex,
      pathTotal: meta.pathTotal,
    });
  };
  tick();
  const timer = setInterval(tick, 400);
  return () => clearInterval(timer);
}

function urlDeleteVariants(url: string): string[] {
  const variants = new Set<string>();
  const add = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    variants.add(trimmed);
    const stripped = trimmed.replace(/\/+$/, "");
    if (stripped) variants.add(stripped);
    if (!trimmed.endsWith("/")) variants.add(`${trimmed}/`);
  };
  add(url);
  add(url.replace(/^(https?:\/\/)www\./i, "$1"));
  add(url.replace(/^(https?:\/\/)/i, "$1www."));
  const keyed = pageRefreshUrlKey(url);
  if (keyed) add(keyed);
  return [...variants];
}

/**
 * Union of saved metadata catalog + vector-backed pages for structural diff.
 */
async function loadIndexedPagesForRefreshDiff(sourceId: string) {
  const byKey = new Map<
    string,
    { url: string; title: string; chunkCount?: number }
  >();

  const addPages = (
    pages: Array<{ url: string; title?: string; chunkCount?: number }>,
  ) => {
    for (const page of pages) {
      if (!page.url) continue;
      const key = pageRefreshUrlKey(page.url);
      if (!byKey.has(key)) {
        byKey.set(key, {
          url: page.url,
          title: page.title?.trim() || page.url,
          chunkCount: page.chunkCount,
        });
      }
    }
  };

  const stored = await getMetadataCatalog(sourceId);
  if (stored?.pages?.length) addPages(stored.pages);

  const vectorCatalog = await rebuildFullCatalogFromVector(sourceId);
  if (vectorCatalog?.pages?.length) {
    addPages(vectorCatalog.pages);
    await saveMetadataCatalog(sourceId, vectorCatalog);
  }

  return [...byKey.values()];
}

const REFRESH_DELETE_CONCURRENCY = 4;

async function deleteVectorsForUrls(
  sourceId: string,
  urls: string[],
  onProgress?: (current: number, total: number) => void,
) {
  if (urls.length === 0) return;

  const uniqueUrls = [...new Set(urls.flatMap((url) => urlDeleteVariants(url)))];
  await ensureChunksIndex();
  const store = getVectorStore();

  await deleteLexicalChunks({ sourceId, urls: uniqueUrls });

  await mapWithConcurrency(
    uniqueUrls,
    REFRESH_DELETE_CONCURRENCY,
    async (url) => {
      assertRefreshNotCancelled(sourceId);
      try {
        await store.deleteVectors({
          indexName: LEDGEINDEX_CHUNKS_INDEX,
          filter: { sourceId, url },
        });
      } catch {
        // Fallback: ignore per-url delete failures; upsert still adds fresh chunks.
      }
    },
    {
      onItemComplete: (completed, total) => {
        onProgress?.(completed, total);
      },
    },
  );
}

async function parseUrlsForRefresh(
  sourceId: string,
  source: Source,
  urls: Array<{ url: string; title?: string }>,
) {
  return mapWithConcurrency(
    urls,
    REFRESH_PARSE_CONCURRENCY,
    async (entry) => {
      assertRefreshNotCancelled(sourceId);
      try {
        const page = await parsePage(
          entry.url,
          source.config.contentSelectors,
          source.config.excludeSelectors,
          source.config.userAgent,
        );
        return {
          url: page.url,
          title: page.title || entry.title || page.url,
          markdown: page.markdown,
        };
      } catch (error) {
        return {
          url: entry.url,
          title: entry.title || entry.url,
          markdown: "",
          error:
            error instanceof Error ? error.message : "Failed to parse page",
        };
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
}

async function finalizeRefreshComparison(
  sourceId: string,
  run: RefreshRunSnapshot,
  snapshots: PageSnapshotInput[],
  parsed: Array<{ url: string; title: string; markdown: string }>,
  total: number,
) {
  assertRefreshNotCancelled(sourceId);
  patchRefreshRun(sourceId, {
    status: "comparing",
    phase: "comparing",
    current: total,
    total,
  });

  const existingSnapshots = await listPageSnapshots(sourceId);

  const source = await getStore().getSource(sourceId);
  const urlOrigin = source?.config?.startUrls?.find(Boolean) ?? "";
  const indexedPages = await loadIndexedPagesForRefreshDiff(sourceId);

  const changelog = buildRefreshChangelog({
    catalogPages: indexedPages,
    incoming: snapshots,
    existingSnapshots,
    urlOrigin,
  });

  const parsedByKey = new Map<
    string,
    { url: string; title: string; markdown: string }
  >();
  for (const page of parsed) {
    parsedByKey.set(pageRefreshUrlKey(page.url, urlOrigin), page);
  }

  const parsedPagesCache: Record<string, { title: string; markdown: string }> =
    {};
  for (const ref of [...changelog.added, ...changelog.updated]) {
    const page =
      parsedByKey.get(pageRefreshUrlKey(ref.url, urlOrigin)) ??
      parsed.find((entry) => entry.url === ref.url);
    if (!page?.markdown.trim()) continue;
    parsedPagesCache[ref.url] = {
      title: page.title,
      markdown: page.markdown,
    };
  }

  patchRefreshRun(sourceId, {
    status: "ready",
    phase: "done",
    current: total,
    total,
    changelog,
    pendingSnapshots: snapshots,
    parsedPagesCache,
  });

  logInfo("Refresh check completed", "SourceRefresh", {
    sourceId,
    runId: run.runId,
    mode: run.mode,
    indexedCatalogPages: indexedPages.length,
    liveDiscoveredPages: snapshots.length,
    sourcePageCount: source?.pageCount ?? null,
    added: changelog.added.length,
    updated: changelog.updated.length,
    removed: changelog.removed.length,
    unchangedCount: changelog.unchangedCount,
    baselineCaptured: changelog.baselineCaptured,
  });
}

async function runSelectedRefreshCheck(
  sourceId: string,
  run: RefreshRunSnapshot,
) {
  const source = await getStore().getSource(sourceId);
  if (!source) {
    throw new Error("Source not found");
  }

  const catalog = await ensureCatalogHasPages(sourceId);
  const urls = catalog?.pages.map((page) => ({
    url: page.url,
    title: page.title,
  })).filter((page) => page.url) ?? [];
  if (urls.length === 0) {
    throw new Error("No indexed pages found in catalog");
  }

  patchRefreshRun(sourceId, {
    status: "parsing",
    phase: "parsing",
    current: 0,
    total: urls.length,
  });

  const parsed = await parseUrlsForRefresh(sourceId, source, urls);

  const snapshots: PageSnapshotInput[] = parsed
    .filter((page) => page.markdown.trim().length > 0)
    .map((page) => ({
      url: page.url,
      title: page.title,
      contentHash: hashForRefresh(page.markdown),
    }));

  await finalizeRefreshComparison(sourceId, run, snapshots, parsed, urls.length);
}

async function runDiscoverRefreshCheck(
  sourceId: string,
  run: RefreshRunSnapshot,
) {
  const source = await getStore().getSource(sourceId);
  if (!source) {
    throw new Error("Source not found");
  }

  const startUrls = [...new Set(source.config.startUrls.filter(Boolean))];
  if (startUrls.length === 0) {
    throw new Error("Source has no start URLs");
  }

  const maxPages = source.config.maxPages;
  const discoveredByUrl = new Map<string, { url: string; title?: string }>();

  // Multi-path sources crawl one start URL at a time so the pipeline can show
  // which path is active. Single-path keeps a one-shot discover.
  for (let i = 0; i < startUrls.length; i++) {
    assertRefreshNotCancelled(sourceId);
    const remaining = Math.max(0, maxPages - discoveredByUrl.size);
    if (remaining === 0) break;

    const startUrl = startUrls[i]!;
    const multiPath = startUrls.length > 1;
    const pathMeta = multiPath
      ? {
          activePath: pathLabelFromStartUrl(startUrl),
          pathIndex: i + 1,
          pathTotal: startUrls.length,
        }
      : {
          activePath: undefined,
          pathIndex: undefined,
          pathTotal: undefined,
        };

    patchRefreshRun(sourceId, {
      status: "discovering",
      phase: "discovering",
      current: discoveredByUrl.size,
      total: maxPages,
      ...pathMeta,
    });

    const stopSync = startRefreshDiscoverProgressSync(sourceId, {
      ...pathMeta,
      pagesAlreadyDiscovered: discoveredByUrl.size,
      maxPages,
    });

    try {
      const discovery = await discoverUrls(
        {
          ...source.config,
          startUrls: [startUrl],
          maxPages: remaining,
        },
        { sourceId },
      );
      for (const page of discovery.urls) {
        if (!page.url || discoveredByUrl.has(page.url)) continue;
        discoveredByUrl.set(page.url, page);
      }
    } finally {
      stopSync();
    }
  }

  assertRefreshNotCancelled(sourceId);

  const discovered = [...discoveredByUrl.values()];
  if (discovered.length === 0) {
    throw new Error("No pages discovered during refresh crawl");
  }

  patchRefreshRun(sourceId, {
    status: "parsing",
    phase: "parsing",
    current: 0,
    total: discovered.length,
    activePath: undefined,
    pathIndex: undefined,
    pathTotal: undefined,
  });

  const parsed = await parseUrlsForRefresh(sourceId, source, discovered);

  const snapshots: PageSnapshotInput[] = parsed
    .filter((page) => page.markdown.trim().length > 0)
    .map((page) => ({
      url: page.url,
      title: page.title,
      contentHash: hashForRefresh(page.markdown),
    }));

  await finalizeRefreshComparison(
    sourceId,
    run,
    snapshots,
    parsed,
    discovered.length,
  );
}

async function runRefreshCheck(sourceId: string, run: RefreshRunSnapshot) {
  if (run.mode === "probe") {
    await runProbeRefreshCheck(sourceId, run);
    return;
  }
  if (run.mode === "selected") {
    await runSelectedRefreshCheck(sourceId, run);
    return;
  }

  await runDiscoverRefreshCheck(sourceId, run);
}

async function runRefreshApply(sourceId: string, run: RefreshRunSnapshot) {
  const changelog = run.changelog;
  if (!changelog) {
    throw new Error("No changelog to apply");
  }

  const urlsToApply = [
    ...changelog.added.map((page) => page.url),
    ...changelog.updated.map((page) => page.url),
  ];

  if (urlsToApply.length === 0 && changelog.removed.length === 0) {
    patchRefreshRun(sourceId, {
      status: "done",
      phase: "done",
    });
    return;
  }

  const source = await getStore().getSource(sourceId);
  if (!source) {
    throw new Error("Source not found");
  }

  const urlOrigin = source.config.startUrls.find(Boolean) ?? "";

  patchRefreshRun(sourceId, {
    status: "applying",
    phase: "parsing",
    current: 0,
    total: urlsToApply.length,
  });

  const cache = run.parsedPagesCache ?? {};
  const cachedPage = (url: string) => {
    const direct = cache[url];
    if (direct?.markdown.trim()) return direct;
    const key = pageRefreshUrlKey(url, urlOrigin);
    for (const [cachedUrl, page] of Object.entries(cache)) {
      if (pageRefreshUrlKey(cachedUrl, urlOrigin) === key && page.markdown.trim()) {
        return page;
      }
    }
    return null;
  };
  const missingUrls = urlsToApply.filter((url) => !cachedPage(url));

  let parsedFromFetch: Array<{ url: string; title: string; markdown: string }> =
    [];
  if (missingUrls.length > 0) {
    parsedFromFetch = await mapWithConcurrency(
      missingUrls,
      REFRESH_PARSE_CONCURRENCY,
      async (url) => {
        assertRefreshNotCancelled(sourceId);
        const page = await parsePage(
          url,
          source.config.contentSelectors,
          source.config.excludeSelectors,
          source.config.userAgent,
        );
        return {
          url: page.url,
          title: page.title || page.url,
          markdown: page.markdown,
        };
      },
      {
        onItemComplete: (completed, total) => {
          patchRefreshRun(sourceId, {
            status: "applying",
            phase: "parsing",
            current: completed,
            total,
          });
        },
      },
    );
  }

  const pagesToIndex = urlsToApply
    .map((url) => {
      const cached = cachedPage(url);
      if (cached?.markdown.trim()) {
        return { url, title: cached.title, markdown: cached.markdown };
      }
      return (
        parsedFromFetch.find(
          (page) =>
            page.url === url ||
            pageRefreshUrlKey(page.url, urlOrigin) ===
              pageRefreshUrlKey(url, urlOrigin),
        ) ?? null
      );
    })
    .filter(
      (page): page is { url: string; title: string; markdown: string } =>
        Boolean(page && page.markdown.trim().length > 0),
    );
  let indexedChunkCount = 0;
  const replaceAll =
    pagesToIndex.length > 0 && changelog.unchangedCount === 0;

  if (pagesToIndex.length > 0) {
    patchRefreshRun(sourceId, {
      status: "applying",
      phase: replaceAll ? "chunking" : "deleting",
      current: 0,
      total: pagesToIndex.length,
    });

    if (!replaceAll) {
      await deleteVectorsForUrls(
        sourceId,
        refreshDeleteUrls({
          ...changelog,
          added: [],
          removed: [],
        }),
        (current, total) => {
          patchRefreshRun(sourceId, {
            status: "applying",
            phase: "deleting",
            current,
            total,
          });
        },
      );
    }

    const prepared = await prepareChunksForPages({
      sourceId,
      projectId: source.projectId,
      pages: pagesToIndex,
      onProgress: (progress) => {
        patchRefreshRun(sourceId, {
          status: "applying",
          phase: progress.phase,
          current: progress.current,
          total: progress.total,
        });
      },
    });

    await storePreparedChunks({
      sourceId,
      prepared,
      pageCount: pagesToIndex.length,
      replaceMode: replaceAll ? "all" : "incremental",
      onProgress: (progress) => {
        patchRefreshRun(sourceId, {
          status: "applying",
          phase: "storing",
          current: progress.current,
          total: progress.total,
        });
      },
    });

    indexedChunkCount = prepared.length;
  }

  if (changelog.removed.length > 0 && !replaceAll) {
    await deleteVectorsForUrls(
      sourceId,
      refreshDeleteUrls({
        ...changelog,
        added: [],
        updated: [],
      }),
    );
  }

  if (pagesToIndex.length > 0) {
    await syncPageSnapshotHashes({
      sourceId,
      crawlRunId: run.crawlRunId,
      snapshots: pagesToIndex.map((page) => ({
        url: page.url,
        title: page.title,
        contentHash: hashForRefresh(page.markdown),
      })),
    });
  }

  if (changelog.removed.length > 0) {
    await tombstonePageSnapshots(
      sourceId,
      refreshDeleteUrls({
        ...changelog,
        added: [],
        updated: [],
      }),
    );
  }

  if (pagesToIndex.length > 0 || changelog.removed.length > 0) {
    const rebuilt = await rebuildFullCatalogFromVector(sourceId);
    if (rebuilt) {
      await saveMetadataCatalog(sourceId, rebuilt);
      const chunkCount = rebuilt.pages.reduce(
        (sum, page) => sum + page.chunkCount,
        0,
      );
      await markSourceIndexed({
        sourceId,
        pageCount: rebuilt.pages.length,
        chunkCount,
      });
    } else if (pagesToIndex.length > 0) {
      await markSourceIndexed({
        sourceId,
        pageCount: changelog.unchangedCount + pagesToIndex.length,
        chunkCount: indexedChunkCount,
      });
    }
  }

  patchRefreshRun(sourceId, {
    status: "done",
    phase: "done",
    current: urlsToApply.length,
    total: urlsToApply.length,
    changelog: {
      baselineCaptured: false,
      unchangedCount:
        changelog.unchangedCount + changelog.added.length + changelog.updated.length,
      added: [],
      updated: [],
      removed: [],
    },
  });

  logInfo("Refresh apply completed", "SourceRefresh", {
    sourceId,
    runId: run.runId,
    appliedPages: pagesToIndex.length,
    removedPages: changelog.removed.length,
  });
}

export async function startSourceRefreshCheck(
  sourceId: string,
  options?: { mode?: RefreshMode },
): Promise<RefreshRunSnapshot> {
  const mode = options?.mode ?? "discover";
  const existing = getActiveRefreshRun(sourceId);
  if (existing && canReuseRefreshRun(existing)) {
    return existing;
  }

  const crawlRun = await getStore().createCrawlRun({
    sourceId,
    kind: "refresh",
  });

  const run = createRefreshRun(sourceId, crawlRun.id, mode);

  void runRefreshCheck(sourceId, run).catch((error) => {
    if (error instanceof Error && error.message === "Refresh cancelled") {
      patchRefreshRun(sourceId, { status: "cancelled", error: error.message });
      return;
    }
    logError(error as Error, "SourceRefresh", { sourceId, runId: run.runId });
    patchRefreshRun(sourceId, {
      status: "failed",
      error: error instanceof Error ? error.message : "Refresh failed",
    });
  });

  return run;
}

export async function applySourceRefresh(sourceId: string) {
  const run = getActiveRefreshRun(sourceId);
  if (!run || run.status !== "ready" || !run.changelog) {
    throw new Error("No refresh results ready to apply");
  }

  const urlsToApply =
    run.changelog.added.length + run.changelog.updated.length;

  patchRefreshRun(sourceId, {
    status: "applying",
    phase: "parsing",
    current: 0,
    total: urlsToApply,
  });

  const applyingRun = getActiveRefreshRun(sourceId);
  if (!applyingRun || !applyingRun.changelog) {
    throw new Error("No refresh results ready to apply");
  }

  void runRefreshApply(sourceId, applyingRun).catch((error) => {
    if (error instanceof Error && error.message === "Refresh cancelled") {
      patchRefreshRun(sourceId, { status: "cancelled", error: error.message });
      return;
    }
    logError(error as Error, "SourceRefreshApply", {
      sourceId,
      runId: applyingRun.runId,
    });
    patchRefreshRun(sourceId, {
      status: "failed",
      error: error instanceof Error ? error.message : "Apply failed",
    });
  });

  return applyingRun;
}

export function toClientRefreshSnapshot(run: RefreshRunSnapshot) {
  return {
    runId: run.runId,
    sourceId: run.sourceId,
    crawlRunId: run.crawlRunId,
    mode: run.mode,
    status: run.status,
    phase: run.phase,
    current: run.current,
    total: run.total,
    activePath: run.activePath,
    pathIndex: run.pathIndex,
    pathTotal: run.pathTotal,
    changelog: run.changelog,
    error: run.error,
    updatedAt: run.updatedAt,
  };
}

export function getSourceRefreshStatus(
  sourceId: string,
): RefreshRunSnapshot | null {
  return getActiveRefreshRun(sourceId);
}

export function listSourceRefreshRuns(): RefreshRunSnapshot[] {
  return listRefreshRuns();
}

export function cancelSourceRefresh(sourceId: string) {
  requestRefreshCancellation(sourceId);
  cancelIngestForSource(sourceId);
  const run = getActiveRefreshRun(sourceId);
  if (run) {
    patchRefreshRun(sourceId, { status: "cancelled" });
  }
  return true;
}

export function dismissSourceRefresh(sourceId: string) {
  clearRefreshRun(sourceId);
}
