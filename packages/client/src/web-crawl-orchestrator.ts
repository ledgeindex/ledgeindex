import {
  createSource,
  discoverHeaderNavPaths,
  getCrawlProgress,
  getIngestWorkflowStatus,
  normalizeStartUrl,
  preflightSite,
  proposeCrawlFilterRemovals,
  resumeIngestWorkflow,
  startIngestWorkflow,
  updateSource,
  type IngestPipelineSnapshot,
  type WebCrawlConfig,
} from "./ledgeindex-api.js";

const DEFAULT_MAX_CRAWL_PAGES = 1_000;

const DEFAULT_CRAWL_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

export function defaultWebCrawlConfig(startUrl: string): WebCrawlConfig {
  return {
    startUrls: [startUrl],
    includePatterns: [],
    excludePatterns: [],
    excludeDownloadPatterns: [],
    patternsAreRegex: false,
    renderJs: false,
    useProxy: false,
    enableSitemap: true,
    sitemapOnly: false,
    sitemapUrls: [],
    fileTypes: ["html"],
    contentSelectors: ["article", "main", ".content", ".documentation"],
    excludeSelectors: ["nav", "footer", ".sidebar", ".toc", ".navigation"],
    maxPages: DEFAULT_MAX_CRAWL_PAGES,
    userAgent: DEFAULT_CRAWL_USER_AGENT,
  };
}

export type CrawlProgressUpdate = {
  phase: "preflight" | "crawl" | "filter" | "index" | "done" | "error";
  detail: string;
  headerNavPaths?: Array<{ url: string; label: string }>;
  crawlProgress?: {
    pagesDiscovered: number;
    maxPages: number;
    phase?: "discovering" | "validating";
    validatedCount?: number;
    validationTotal?: number;
    httpErrorCount?: number;
  };
  pipeline?: IngestPipelineSnapshot;
};

type DiscoveredUrl = {
  url: string;
  title?: string;
  httpStatus?: number;
  httpErrorReason?: string;
};

type CrawlSuspendPayload = {
  urls?: DiscoveredUrl[];
  skipped?: { url: string; reason: string }[];
  pagesDiscovered?: number;
  httpStatusFiltered?: number;
};

export type RunWebCrawlOptions = {
  url: string;
  name?: string;
  slug?: string;
  maxPages?: number;
  autoFilter?: boolean;
  /** Scan header nav for sibling docs sections and add them as start URLs. */
  discoverHeaderNav?: boolean;
  enrichExamples?: boolean;
  scope?: "personal" | "global";
  onProgress?: (update: CrawlProgressUpdate) => void;
};

export type RunWebCrawlResult = {
  sourceId: string;
  runId: string;
  name: string;
  url: string;
  pageCount: number;
  chunkCount: number;
};

function emit(
  onProgress: RunWebCrawlOptions["onProgress"],
  update: CrawlProgressUpdate,
) {
  onProgress?.(update);
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isSelectableUrl(item: DiscoveredUrl): boolean {
  return item.httpStatus == null && !item.httpErrorReason;
}

async function pollCrawlWhileStarting(
  sourceId: string,
  onProgress: RunWebCrawlOptions["onProgress"],
  maxPages: number,
  signal: AbortSignal,
) {
  while (!signal.aborted) {
    try {
      const progress = await getCrawlProgress(sourceId);
      if (progress.active) {
        emit(onProgress, {
          phase: "crawl",
          detail:
            progress.phase === "validating"
              ? `validating ${progress.validatedCount ?? 0}/${progress.validationTotal ?? 0}`
              : `discovering ${progress.pagesDiscovered} pages`,
          crawlProgress: {
            pagesDiscovered: progress.pagesDiscovered,
            maxPages: progress.maxPages || maxPages,
            phase: progress.phase,
            validatedCount: progress.validatedCount,
            validationTotal: progress.validationTotal,
            httpErrorCount: progress.httpErrorCount,
          },
        });
      }
    } catch {
      // API may not be ready yet
    }
    await sleep(750);
  }
}

async function applyAutoFilter(
  urls: DiscoveredUrl[],
  startUrls: string[],
): Promise<string[]> {
  const indexed = urls.map((item, index) => ({
    index,
    url: item.url,
    ...(item.title?.trim() ? { title: item.title.trim() } : {}),
  }));

  const ai = await proposeCrawlFilterRemovals({
    startUrls,
    urls: indexed,
  });

  const removeSet = new Set(ai.removeIndexes);
  return urls
    .filter((_, index) => !removeSet.has(index))
    .filter(isSelectableUrl)
    .map((item) => item.url);
}

async function pollIngestUntilDone(
  sourceId: string,
  runId: string,
  onProgress: RunWebCrawlOptions["onProgress"],
): Promise<IngestPipelineSnapshot> {
  for (;;) {
    const { snapshot } = await getIngestWorkflowStatus(sourceId, runId);
    const live = snapshot.liveProgress;
    const phase = snapshot.livePhase;
    let detail = snapshot.status;

    if (phase === "extracting" && live) {
      detail = `extracting ${live.current}/${live.total}`;
    } else if (phase === "enriching" && live) {
      detail = `enriching ${live.current}/${live.total}`;
    } else if (phase === "chunking" || phase === "embedding") {
      detail = live
        ? `indexing ${live.current}/${live.total} chunks`
        : "indexing…";
    } else if (phase === "storing") {
      detail = "storing…";
    }

    emit(onProgress, {
      phase: "index",
      detail,
      pipeline: snapshot,
    });

    if (snapshot.status === "success") {
      return snapshot;
    }
    if (snapshot.status === "failed") {
      throw new Error(snapshot.error ?? "Ingest workflow failed");
    }

    await sleep(800);
  }
}

async function resumeThroughIndex(
  sourceId: string,
  runId: string,
  selectedUrls: string[],
  enrichExamples: boolean,
  onProgress: RunWebCrawlOptions["onProgress"],
): Promise<IngestPipelineSnapshot> {
  let { snapshot } = await resumeIngestWorkflow(sourceId, runId, {
    step: "crawl-review-step",
    resumeData: { selectedUrls, enrichExamples },
  });

  if (snapshot.status === "success") {
    return snapshot;
  }

  if (snapshot.suspendedStep === "parse-review-step") {
    ({ snapshot } = await resumeIngestWorkflow(sourceId, runId, {
      step: "parse-review-step",
      resumeData: { confirmed: true, enrichExamples },
    }));
    if (snapshot.status === "success") {
      return snapshot;
    }
  }

  if (snapshot.suspendedStep === "enrich-step") {
    ({ snapshot } = await resumeIngestWorkflow(sourceId, runId, {
      step: "enrich-step",
      resumeData: { confirmed: true },
    }));
    if (snapshot.status === "success") {
      return snapshot;
    }
  }

  return pollIngestUntilDone(sourceId, runId, onProgress);
}

function mergeHeaderNavStartUrls(
  primaryUrl: string,
  siblingUrls: string[],
): string[] {
  const primary = normalizeStartUrl(primaryUrl.trim());
  if (!primary) return [];
  const out = [primary];
  const seen = new Set<string>([primary]);
  for (const raw of siblingUrls) {
    const url = normalizeStartUrl(raw.trim());
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push(url);
  }
  return out;
}

async function resolveCrawlStartUrls(
  normalizedUrl: string,
  options: RunWebCrawlOptions,
): Promise<string[]> {
  if (!options.discoverHeaderNav) {
    return [normalizedUrl];
  }

  emit(options.onProgress, {
    phase: "preflight",
    detail: "scanning header nav for sibling sections…",
  });

  try {
    const result = await discoverHeaderNavPaths(normalizedUrl);
    const merged = mergeHeaderNavStartUrls(
      normalizedUrl,
      result.paths.map((path) => path.url),
    );
    if (merged.length > 1) {
      emit(options.onProgress, {
        phase: "preflight",
        detail: `header nav: +${merged.length - 1} section${merged.length - 1 === 1 ? "" : "s"} (${result.paths.map((path) => path.label).join(", ")})`,
        headerNavPaths: result.paths,
      });
    } else {
      emit(options.onProgress, {
        phase: "preflight",
        detail:
          result.reason || "header nav: no extra sections beside start URL",
      });
    }
    return merged;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    emit(options.onProgress, {
      phase: "preflight",
      detail: `header nav scan skipped: ${message}`,
    });
    return [normalizedUrl];
  }
}

export async function runWebCrawl(
  options: RunWebCrawlOptions,
): Promise<RunWebCrawlResult> {
  const normalizedUrl = options.url.trim();
  if (!normalizedUrl) {
    throw new Error("Start URL is required");
  }

  emit(options.onProgress, { phase: "preflight", detail: "checking URL…" });
  const { preflight } = await preflightSite(normalizedUrl);
  if (!preflight.ok) {
    throw new Error(`Preflight failed (HTTP ${preflight.status})`);
  }

  const name = options.name?.trim() || preflight.siteName || normalizedUrl;
  const slug = options.slug?.trim() || preflight.siteSlug;
  const startUrls = await resolveCrawlStartUrls(normalizedUrl, options);
  const config = defaultWebCrawlConfig(normalizedUrl);
  config.startUrls = startUrls;
  if (options.maxPages != null) {
    config.maxPages = options.maxPages;
  }

  const { source } = await createSource({
    name,
    slug,
    scope: options.scope ?? "personal",
    config,
    sourceMetadata: preflight.metadata ?? null,
  });

  await updateSource(source.id, {
    name,
    config,
    ogImageUrl: preflight.ogImage ?? null,
    faviconUrl: preflight.faviconUrl ?? null,
    sourceMetadata: preflight.metadata ?? null,
  });

  const abort = new AbortController();
  const pollTask = pollCrawlWhileStarting(
    source.id,
    options.onProgress,
    config.maxPages,
    abort.signal,
  );

  emit(options.onProgress, { phase: "crawl", detail: "starting crawl…" });

  let snapshot: IngestPipelineSnapshot;
  try {
    ({ snapshot } = await startIngestWorkflow(source.id, { config }));
  } finally {
    abort.abort();
    await pollTask.catch(() => undefined);
  }

  if (snapshot.suspendedStep !== "crawl-review-step") {
    throw new Error(
      `Unexpected workflow state after crawl: ${snapshot.suspendedStep ?? snapshot.status}`,
    );
  }

  const payload = (snapshot.suspendPayload ?? {}) as CrawlSuspendPayload;
  const urls = payload.urls ?? [];
  if (urls.length === 0) {
    const reason = payload.skipped?.[0]?.reason;
    throw new Error(
      reason
        ? `No pages discovered. ${payload.skipped?.[0]?.url}: ${reason}`
        : "No pages discovered",
    );
  }

  let selectedUrls = urls.filter(isSelectableUrl).map((item) => item.url);

  if (options.autoFilter) {
    emit(options.onProgress, {
      phase: "filter",
      detail: `filtering ${urls.length} URLs…`,
    });
    selectedUrls = await applyAutoFilter(urls, config.startUrls);
  }

  if (selectedUrls.length === 0) {
    throw new Error("No URLs left after filtering");
  }

  emit(options.onProgress, {
    phase: "index",
    detail: `indexing ${selectedUrls.length} pages…`,
  });

  const finalSnapshot = await resumeThroughIndex(
    source.id,
    snapshot.runId,
    selectedUrls,
    options.enrichExamples === true,
    options.onProgress,
  );

  const pageCount = finalSnapshot.result?.pageCount ?? selectedUrls.length;
  const chunkCount = finalSnapshot.result?.chunkCount ?? 0;

  emit(options.onProgress, {
    phase: "done",
    detail: `indexed ${pageCount} pages (${chunkCount} chunks)`,
    pipeline: finalSnapshot,
  });

  return {
    sourceId: source.id,
    runId: snapshot.runId,
    name,
    url: normalizedUrl,
    pageCount,
    chunkCount,
  };
}
