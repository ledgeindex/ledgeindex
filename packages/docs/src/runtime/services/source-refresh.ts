import type { Source } from "@ledgeindex/core/db/types.js";
import { normalizeCanonicalUrl } from "@ledgeindex/core/lib/canonical-url.js";
import { discoverUrls, getCrawlProgress } from "../crawler/discover.js";
import { getStore } from "../db/index.js";
import {
  applyPageSnapshotRefresh,
  comparePageSnapshotRefresh,
  hashPageContent,
  type PageSnapshotInput,
} from "../db/page-snapshots.js";
import { runProbeRefreshCheck } from "./source-refresh-probe.js";
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
  patchRefreshRun,
  requestRefreshCancellation,
  canReuseRefreshRun,
  type RefreshChangelog,
  type RefreshMode,
  type RefreshRunSnapshot,
} from "../refresh/active-refresh-runs.js";

const REFRESH_PARSE_CONCURRENCY = Math.max(
  1,
  Number(process.env.LEDGEINDEX_EXTRACT_CONCURRENCY ?? 8) || 8,
);

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

function toChangelog(result: {
  baselineCaptured: boolean;
  unchangedCount: number;
  added: PageSnapshotInput[];
  updated: PageSnapshotInput[];
  removed: Array<{ url: string; title: string }>;
}): RefreshChangelog {
  return {
    baselineCaptured: result.baselineCaptured,
    unchangedCount: result.unchangedCount,
    added: result.added.map((page) => ({ url: page.url, title: page.title })),
    updated: result.updated.map((page) => ({ url: page.url, title: page.title })),
    removed: result.removed.map((page) => ({ url: page.url, title: page.title })),
  };
}

function resolveRefreshUrl(raw: string, origin: string): string {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("/") && origin) {
    try {
      return new URL(trimmed, origin).href;
    } catch {
      // fall through
    }
  }
  return trimmed;
}

function refreshUrlKey(url: string, origin = ""): string {
  const resolved = resolveRefreshUrl(url, origin);
  const normalized = normalizeCanonicalUrl(resolved);
  const base = normalized || resolved.toLowerCase();
  return base.replace(/^(https?:\/\/)www\./i, "$1");
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
      const key = refreshUrlKey(page.url);
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

/**
 * Diff live discovery against indexed catalog — not snapshot baseline noise.
 */
function buildStructuralChangelog(
  catalogPages: Array<{ url: string; title?: string }>,
  incoming: PageSnapshotInput[],
  comparison: {
    baselineCaptured: boolean;
    unchangedCount: number;
    added: PageSnapshotInput[];
    updated: PageSnapshotInput[];
    removed: Array<{ url: string; title: string }>;
  },
  urlOrigin: string,
): RefreshChangelog {
  if (catalogPages.length === 0) {
    if (comparison.baselineCaptured) {
      return {
        baselineCaptured: true,
        unchangedCount: 0,
        added: incoming.map((page) => ({ url: page.url, title: page.title })),
        updated: [],
        removed: [],
      };
    }
    return toChangelog(comparison);
  }

  const incomingUrls = new Set(
    incoming.map((snapshot) => refreshUrlKey(snapshot.url, urlOrigin)),
  );
  const catalogByKey = new Map<string, { url: string; title: string }>();
  for (const page of catalogPages) {
    if (!page.url) continue;
    const key = refreshUrlKey(page.url, urlOrigin);
    if (!catalogByKey.has(key)) {
      catalogByKey.set(key, {
        url: page.url,
        title: page.title?.trim() || page.url,
      });
    }
  }

  const added: Array<{ url: string; title: string }> = [];
  const addedKeys = new Set<string>();
  for (const snapshot of incoming) {
    const key = refreshUrlKey(snapshot.url, urlOrigin);
    if (catalogByKey.has(key) || addedKeys.has(key)) continue;
    added.push({ url: snapshot.url, title: snapshot.title });
    addedKeys.add(key);
  }

  const removedKeys = new Set<string>();
  const removed: Array<{ url: string; title: string }> = [];
  for (const [key, entry] of catalogByKey) {
    if (incomingUrls.has(key) || removedKeys.has(key)) continue;
    removed.push({ url: entry.url, title: entry.title });
    removedKeys.add(key);
  }

  const updatedKeys = new Set(
    comparison.baselineCaptured
      ? []
      : comparison.updated.map((page) => refreshUrlKey(page.url, urlOrigin)),
  );
  const updated = comparison.baselineCaptured
    ? []
    : comparison.updated
        .filter((page) =>
          catalogByKey.has(refreshUrlKey(page.url, urlOrigin)),
        )
        .map((page) => ({ url: page.url, title: page.title }));

  const unchangedCount = incoming.filter((snapshot) => {
    const key = refreshUrlKey(snapshot.url, urlOrigin);
    return (
      catalogByKey.has(key) &&
      !addedKeys.has(key) &&
      !updatedKeys.has(key)
    );
  }).length;

  return {
    baselineCaptured: false,
    added,
    updated,
    removed,
    unchangedCount,
  };
}

async function deleteVectorsForUrls(sourceId: string, urls: string[]) {
  if (urls.length === 0) return;

  await ensureChunksIndex();
  const store = getVectorStore();

  for (const url of urls) {
    try {
      await store.deleteVectors({
        indexName: LEDGEINDEX_CHUNKS_INDEX,
        filter: { sourceId, url },
      });
    } catch {
      // Fallback: ignore per-url delete failures; upsert still adds fresh chunks.
    }
    await deleteLexicalChunks({ sourceId, url });
  }
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

  const comparison = await comparePageSnapshotRefresh({
    sourceId,
    snapshots,
  });

  const source = await getStore().getSource(sourceId);
  const urlOrigin = source?.config?.startUrls?.find(Boolean) ?? "";
  const indexedPages = await loadIndexedPagesForRefreshDiff(sourceId);

  const changelog = buildStructuralChangelog(
    indexedPages,
    snapshots,
    comparison,
    urlOrigin,
  );

  const changedUrls = new Set([
    ...changelog.added.map((page) => page.url),
    ...changelog.updated.map((page) => page.url),
  ]);

  const parsedPagesCache: Record<string, { title: string; markdown: string }> =
    {};
  for (const page of parsed) {
    if (changedUrls.has(page.url) && page.markdown.trim().length > 0) {
      parsedPagesCache[page.url] = {
        title: page.title,
        markdown: page.markdown,
      };
    }
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
      contentHash: hashPageContent(page.markdown),
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
      contentHash: hashPageContent(page.markdown),
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

  patchRefreshRun(sourceId, {
    status: "applying",
    phase: "parsing",
    current: 0,
    total: urlsToApply.length,
  });

  const cache = run.parsedPagesCache ?? {};
  const missingUrls = urlsToApply.filter((url) => !cache[url]?.markdown.trim());

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
  } else {
    patchRefreshRun(sourceId, {
      status: "applying",
      phase: "embedding",
      current: 0,
      total: urlsToApply.length,
    });
  }

  const pagesToIndex = urlsToApply
    .map((url) => {
      const cached = cache[url];
      if (cached?.markdown.trim()) {
        return { url, title: cached.title, markdown: cached.markdown };
      }
      return parsedFromFetch.find((page) => page.url === url);
    })
    .filter(
      (page): page is { url: string; title: string; markdown: string } =>
        Boolean(page && page.markdown.trim().length > 0),
    );
  let indexedChunkCount = 0;

  if (pagesToIndex.length > 0) {
    patchRefreshRun(sourceId, {
      status: "applying",
      phase: "embedding",
      current: 0,
      total: pagesToIndex.length,
    });

    await deleteVectorsForUrls(
      sourceId,
      pagesToIndex.map((page) => page.url),
    );

    const prepared = await prepareChunksForPages({
      sourceId,
      projectId: source.projectId,
      pages: pagesToIndex,
      onProgress: (progress) => {
        if (progress.phase === "embedding") {
          patchRefreshRun(sourceId, {
            status: "applying",
            phase: "embedding",
            current: progress.current,
            total: progress.total,
          });
        }
      },
    });

    await storePreparedChunks({
      sourceId,
      prepared,
      pageCount: pagesToIndex.length,
      replaceMode: "incremental",
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

  if (changelog.removed.length > 0) {
    await deleteVectorsForUrls(
      sourceId,
      changelog.removed.map((page) => page.url),
    );
  }

  if (run.pendingSnapshots && run.pendingSnapshots.length > 0) {
    await applyPageSnapshotRefresh({
      sourceId,
      crawlRunId: run.crawlRunId,
      snapshots: run.pendingSnapshots,
    });
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

export function getSourceRefreshStatus(
  sourceId: string,
): RefreshRunSnapshot | null {
  return getActiveRefreshRun(sourceId);
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
