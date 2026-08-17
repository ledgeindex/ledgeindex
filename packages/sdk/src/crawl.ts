import { preflightStartUrl } from "@ledgeindex/core/crawl/preflight.js";
import { proposeCrawlFilterRemovals } from "@ledgeindex/core/crawl/crawl-url-filter.js";
import { DEFAULT_CRAWL_USER_AGENT } from "@ledgeindex/core/crawl/crawl-user-agent.js";
import type { WebCrawlSourceConfig } from "@ledgeindex/core/schemas/source-config.js";
import { getCrawlProgress } from "@ledgeindex/docs/runtime/crawler/discover.js";
import type { IngestPipelineSnapshot } from "@ledgeindex/docs/runtime/ingest/pipeline-status.js";
import {
  getIngestWorkflowStatus,
  resumeIngestWorkflow,
  startIngestWorkflow,
} from "@ledgeindex/docs/runtime/ingest/workflow-runner.js";
import { assertChatModelAvailable } from "./resolve-options.js";
import {
  createWebCrawlSource,
  updateWebCrawlSource,
} from "./sources.js";
import { getActiveOptions } from "./runtime.js";

const DEFAULT_MAX_CRAWL_PAGES = 1_000;

export function defaultWebCrawlConfig(startUrl: string): WebCrawlSourceConfig {
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

import type { LedgeIndexCrawlOptions } from "./types.js";

export type RunWebCrawlOptions = LedgeIndexCrawlOptions;

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
    const progress = getCrawlProgress(sourceId);
    if (progress?.status === "running") {
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
  runId: string,
  onProgress: RunWebCrawlOptions["onProgress"],
): Promise<IngestPipelineSnapshot> {
  for (;;) {
    const snapshot = await getIngestWorkflowStatus(runId);
    if (!snapshot) {
      throw new Error(`Ingest run not found: ${runId}`);
    }

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
  runId: string,
  selectedUrls: string[],
  enrichExamples: boolean,
  onProgress: RunWebCrawlOptions["onProgress"],
): Promise<IngestPipelineSnapshot> {
  let snapshot = await resumeIngestWorkflow({
    runId,
    step: "crawl-review-step",
    resumeData: { selectedUrls, enrichExamples },
  });

  if (snapshot.status === "success") {
    return snapshot;
  }

  if (snapshot.suspendedStep === "parse-review-step") {
    snapshot = await resumeIngestWorkflow({
      runId,
      step: "parse-review-step",
      resumeData: { confirmed: true, enrichExamples },
    });
    if (snapshot.status === "success") {
      return snapshot;
    }
  }

  if (snapshot.suspendedStep === "enrich-step") {
    snapshot = await resumeIngestWorkflow({
      runId,
      step: "enrich-step",
      resumeData: { confirmed: true },
    });
    if (snapshot.status === "success") {
      return snapshot;
    }
  }

  return pollIngestUntilDone(runId, onProgress);
}

export async function runWebCrawl(
  options: RunWebCrawlOptions,
): Promise<RunWebCrawlResult> {
  const normalizedUrl = options.url.trim();
  if (!normalizedUrl) {
    throw new Error("Start URL is required");
  }

  emit(options.onProgress, { phase: "preflight", detail: "checking URL…" });
  const preflight = await preflightStartUrl(normalizedUrl);
  if (!preflight.ok) {
    throw new Error(`Preflight failed (HTTP ${preflight.status})`);
  }

  const resolved = getActiveOptions();
  if (options.autoFilter) {
    assertChatModelAvailable(resolved, "autoFilter");
  }
  if (options.enrichExamples) {
    assertChatModelAvailable(resolved, "enrichExamples");
  }

  const name = options.name?.trim() || preflight.siteName || normalizedUrl;
  const slug = options.slug?.trim() || preflight.siteSlug;
  const config = defaultWebCrawlConfig(normalizedUrl);
  if (options.maxPages != null) {
    config.maxPages = options.maxPages;
  }
  if (options.crawlConfig) {
    Object.assign(config, options.crawlConfig);
  }

  const source = await createWebCrawlSource({
    name,
    slug,
    scope: options.scope ?? "personal",
    config,
    sourceMetadata: preflight.metadata ?? null,
  });

  await updateWebCrawlSource(source.id, {
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
    snapshot = await startIngestWorkflow({
      sourceId: source.id,
      projectId: source.projectId,
      config,
    });
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
