"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type MouseEvent as ReactMouseEvent } from "react";
import { createPortal } from "react-dom";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { IngestPipelineFlow } from "@/components/sources/ingest-pipeline-flow";
import { CrawlUrlFilterAssistant } from "@/components/sources/crawl-url-filter-assistant";
import { MobileMenuButton } from "@/components/app/app-shell";
import {
  KnowledgeSetScopeToggle,
  type KnowledgeSetScope,
} from "@/components/sources/knowledge-set-scope-toggle";
import { SourceHostingToggle } from "@/components/sources/source-hosting-toggle";
import { useAuth } from "@/lib/auth-context";
import {
  syncApiBaseForHosting,
  syncDesktopApiBaseForScope,
} from "@/lib/desktop-api-routing";
import { useHostingCapabilities } from "@/lib/use-hosting-capabilities";
import type { SourceHosting } from "@ledgeindex/client";
import { resolveDisplayPipeline } from "@/lib/ingest-pipeline";
import {
  loadRecentStartUrls,
  rememberStartUrls,
} from "@/lib/recent-start-urls";
import { getDevProjectId, setDevProjectId } from "@/lib/dev-project";
import {
  formatDetectedSignal,
  getDisplayDetectedSignals,
  SOURCE_CONTENT_TYPE_LABELS,
  type SourceMetadata,
} from "@/lib/source-metadata";
import { partitionSkippedUrls } from "@/lib/canonical-dedupe";
import {
  SourceVersionResolutionModal,
  type VersionResolutionChoice,
} from "@/components/sources/source-version-resolution-modal";
import {
  cancelIngestCrawl,
  checkSourceDuplicates,
  createProject,
  createSource,
  estimateIndexSize,
  getCrawlProgress,
  getCrawlRun,
  getMetadataCatalog,
  getSource,
  tryGetIngestWorkflowStatus,
  getIngestWorkflowStatus,
  indexPreviewPages,
  KnowledgeIndexApiError,
  normalizeStartUrl,
  preflightSite,
  resumeIngestWorkflow,
  runParsePreview,
  startIngestWorkflow,
  updateSource,
  UNSUPPORTED_PDF_START_URL_MESSAGE,
  isPdfUrl,
  type CrawlRun,
  type DiscoverySignals,
  type IngestPipelineSnapshot,
  type IndexSizeEstimate,
  type ParsePreviewPage,
  type SourceDuplicateMatch,
  type WebCrawlConfig,
} from "@/lib/ledgeindex-api";
import {
  collectUrlsForPathSegments,
  filterUrlsByPathSegment,
  getPathSegmentSelectionState,
  groupDiscoveredUrlsByPath,
} from "@/lib/crawl-url-breakdown";
import {
  pathSegmentLabelForUrl,
  sourcePathLabelForUrl,
} from "@/lib/source-paths";

const BOT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
const CRAWL_PREVIEW_STORAGE_KEY = "knowledgeindex:web-crawl-preview";
const LEGACY_CRAWL_PREVIEW_STORAGE_KEY = CRAWL_PREVIEW_STORAGE_KEY;
const INDEX_ESTIMATE_SAMPLE_LIMIT = 120;

type CrawlPreviewScope = "personal" | "global";

function dashboardIndexRedirectUrl(
  sourceId: string,
  scope: KnowledgeSetScope,
): string {
  const params = new URLSearchParams({ indexed: sourceId });
  if (scope === "global") {
    params.set("scope", "global");
  }
  return `/dashboard?${params.toString()}`;
}

function crawlPreviewStorageKey(scope: CrawlPreviewScope): string {
  return `${CRAWL_PREVIEW_STORAGE_KEY}:${scope}`;
}

function clearCrawlPreviewStorage(scope: CrawlPreviewScope) {
  try {
    sessionStorage.removeItem(crawlPreviewStorageKey(scope));
    sessionStorage.removeItem(LEGACY_CRAWL_PREVIEW_STORAGE_KEY);
  } catch {
    // ignore
  }
}

function readCrawlPreviewStorage(scope: CrawlPreviewScope): string | null {
  try {
    const scoped = sessionStorage.getItem(crawlPreviewStorageKey(scope));
    if (scoped) return scoped;

    const legacy = sessionStorage.getItem(LEGACY_CRAWL_PREVIEW_STORAGE_KEY);
    if (!legacy) return null;

    sessionStorage.removeItem(LEGACY_CRAWL_PREVIEW_STORAGE_KEY);
    if (scope === "personal") {
      sessionStorage.setItem(crawlPreviewStorageKey(scope), legacy);
    }
    return scope === "personal" ? legacy : null;
  } catch {
    return null;
  }
}
const PARSE_PREVIEW_URL_LIMIT = 3;
const MAX_STORED_SELECTION_URLS = 500;

type CrawlCardPhase = "idle" | "crawling" | "complete";

type StoredCrawlPreviewV3 = {
  v: 3;
  sourceId: string;
  ingestRunId: string;
  selectedPreviewUrls?: string[];
  parsePageSummaries?: Array<{ url: string; title: string; error?: string }>;
  step: 1 | 2;
};

type StoredCrawlPreviewV2 = {
  v: 2;
  sourceId: string;
  crawlRunId: string;
  selectedPreviewUrls?: string[];
  parsePageSummaries?: Array<{ url: string; title: string; error?: string }>;
  step: 1 | 2;
};

type StoredCrawlPreviewLegacy = {
  crawlRun: CrawlRun;
  selectedPreviewUrls: string[];
  parsePages: ParsePreviewPage[];
  step: 1 | 2;
};

function normalizeStoredSelection(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }

  if (typeof value === "string" && value.includes("http")) {
    return value
      .split(/,\s*(?=https?:\/\/)/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
}

function crawlRunFromCrawlReviewSnapshot(
  snapshot: IngestPipelineSnapshot,
  resolvedSourceId: string,
): CrawlRun | null {
  if (snapshot.suspendedStep !== "crawl-review-step") return null;

  const payload = snapshot.suspendPayload as {
    urls?: { url: string; title?: string }[];
    skipped?: { url: string; reason: string }[];
    pagesDiscovered?: number;
  };
  const urls = payload.urls ?? [];
  if (urls.length === 0) return null;

  return {
    id: snapshot.runId,
    sourceId: resolvedSourceId,
    kind: "preview",
    status: "completed",
    pagesDiscovered: payload.pagesDiscovered ?? urls.length,
    result: {
      urls,
      skipped: payload.skipped ?? [],
    },
  };
}

function parsePagesFromParseReviewSnapshot(
  snapshot: IngestPipelineSnapshot,
): ParsePreviewPage[] {
  if (snapshot.suspendedStep !== "parse-review-step") return [];

  const payload = snapshot.suspendPayload as {
    pages?: ParsePreviewPage[];
  };
  return payload.pages ?? [];
}

function buildStoredCrawlPreview(input: {
  sourceId: string;
  ingestRunId: string;
  selectedPreviewUrls: string[];
  parsePages: ParsePreviewPage[];
  step: 1 | 2;
}): StoredCrawlPreviewV3 {
  const payload: StoredCrawlPreviewV3 = {
    v: 3,
    sourceId: input.sourceId,
    ingestRunId: input.ingestRunId,
    step: input.step,
  };

  if (
    input.selectedPreviewUrls.length > 0 &&
    input.selectedPreviewUrls.length <= MAX_STORED_SELECTION_URLS
  ) {
    payload.selectedPreviewUrls = input.selectedPreviewUrls;
  }

  if (input.parsePages.length > 0) {
    payload.parsePageSummaries = input.parsePages.map(({ url, title, error }) => ({
      url,
      title,
      error,
    }));
  }

  return payload;
}

function persistCrawlPreview(input: {
  scope: CrawlPreviewScope;
  sourceId: string;
  ingestRunId: string;
  selectedPreviewUrls: string[];
  parsePages: ParsePreviewPage[];
  step: 1 | 2;
}) {
  const payload = buildStoredCrawlPreview(input);
  const storageKey = crawlPreviewStorageKey(input.scope);

  try {
    sessionStorage.setItem(storageKey, JSON.stringify(payload));
    return;
  } catch {
    // Fall back to the smallest restorable snapshot.
  }

  try {
    sessionStorage.setItem(
      storageKey,
      JSON.stringify({
        v: 3,
        sourceId: input.sourceId,
        ingestRunId: input.ingestRunId,
        step: input.step,
      } satisfies StoredCrawlPreviewV3),
    );
  } catch {
    clearCrawlPreviewStorage(input.scope);
  }
}

function parsePageSummariesToPreview(
  summaries: Array<{ url: string; title: string; error?: string }>,
): ParsePreviewPage[] {
  return summaries.map((page) => ({
    url: page.url,
    title: page.title,
    markdown: "",
    error: page.error,
  }));
}

const MAX_CRAWL_PAGES = 1_000;
const DEFAULT_MAX_CRAWL_PAGES = 1_000;

const DEFAULT_CONFIG = (startUrl: string): WebCrawlConfig => ({
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
  userAgent: BOT_USER_AGENT,
});

function linesToList(value: string) {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function selectorsToList(value: string) {
  return value
    .split(/[\n,]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function buildStartUrls(primary: string, additional: string[]) {
  const urls = [primary, ...additional]
    .map((url) => normalizeStartUrl(url.trim()))
    .filter((url) => {
      if (!url) return false;
      try {
        const parsed = new URL(url);
        return Boolean(parsed.hostname);
      } catch {
        return false;
      }
    });

  return [...new Set(urls)];
}

function resolveSourceName(name: string, primaryUrl: string) {
  const trimmed = name.trim();
  if (trimmed) return trimmed;

  const normalized = normalizeStartUrl(primaryUrl.trim());
  if (normalized) return formatUrlLabel(normalized);

  return "Web crawl source";
}

function formatPreflightError(error: unknown): string {
  if (error instanceof KnowledgeIndexApiError) {
    if (error.status === 0) {
      return error.message;
    }
    if (error.status === 401) {
      return "Sign-in expired — refresh the page or sign in again.";
    }
    if (error.status >= 500) {
      return error.message || "LedgeIndex API error — try again or contact support.";
    }
    return error.message;
  }

  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return "Check failed — you can still try crawling.";
}

function formatPreflightHttpError(status: number): string {
  if (status === 0) {
    return "Couldn't reach this URL — you can still try crawling.";
  }
  if (status === 403 || status === 401) {
    return `Site blocked the request (HTTP ${status}). Often Cloudflare or similar. We'll use a browser-style request; if it still fails, a headless browser crawl is the next step.`;
  }
  if (status >= 400) {
    return `Site returned HTTP ${status} — you can still try crawling.`;
  }
  return "Couldn't reach this URL — you can still try crawling.";
}

function reconcilePreviewSelection(
  discovered: { url: string }[],
  current: string[],
) {
  const discoveredUrls = discovered.map((item) => item.url);
  const discoveredSet = new Set(discoveredUrls);
  const matched = current.filter((url) => discoveredSet.has(url));

  if (matched.length > 0) {
    return matched;
  }

  return discoveredUrls;
}

export function WebCrawlSetup() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isAdmin } = useAuth();
  const hostingCaps = useHostingCapabilities();
  const initialUrl = normalizeStartUrl(searchParams.get("url") ?? "");
  const sourceScope: KnowledgeSetScope =
    searchParams.get("scope") === "global" ? "global" : "personal";
  const [sourceHosting, setSourceHosting] = useState<SourceHosting>("local");

  useEffect(() => {
    if (!hostingCaps.ready) return;
    if (!hostingCaps.localAvailable) {
      setSourceHosting("cloud");
      return;
    }
    setSourceHosting(hostingCaps.default);
  }, [hostingCaps.ready, hostingCaps.localAvailable, hostingCaps.default]);

  useEffect(() => {
    if (sourceScope === "global") {
      syncDesktopApiBaseForScope("global");
      return;
    }
    syncApiBaseForHosting({ scope: sourceScope, hosting: sourceHosting });
  }, [sourceScope, sourceHosting]);

  const replaceSourceIdParam = searchParams.get("replaceSourceId");
  const isReplaceRecrawl =
    searchParams.get("mode") === "replace" && Boolean(replaceSourceIdParam);
  const refreshSelectSourceIdParam = searchParams.get("sourceId");
  const isRefreshSelect =
    searchParams.get("mode") === "refresh-select" &&
    Boolean(refreshSelectSourceIdParam);
  const shouldRestoreSession = useRef(
    searchParams.get("fresh") !== "1" && !isRefreshSelect,
  );

  function handleScopeChange(next: KnowledgeSetScope) {
    if (toolbarLocked) return;
    if (next === sourceScope) return;

    syncDesktopApiBaseForScope(next);

    const params = new URLSearchParams(searchParams.toString());
    if (next === "global") {
      params.set("scope", "global");
    } else {
      params.delete("scope");
    }

    const query = params.toString();
    router.replace(query ? `/sources/web-crawl?${query}` : "/sources/web-crawl");
  }

  const [step, setStep] = useState<1 | 2>(1);
  const [primaryStartUrl, setPrimaryStartUrl] = useState(initialUrl);
  const [additionalStartUrls, setAdditionalStartUrls] = useState<string[]>([]);
  const [sourceName, setSourceName] = useState("");
  const [preflightOgImage, setPreflightOgImage] = useState<string | null>(null);
  const [preflightFaviconUrl, setPreflightFaviconUrl] = useState<string | null>(
    null,
  );
  const [preflightTitle, setPreflightTitle] = useState("");
  const [preflightCheckedUrl, setPreflightCheckedUrl] = useState("");
  const [discoverySignals, setDiscoverySignals] =
    useState<DiscoverySignals | null>(null);
  const [sourceMetadata, setSourceMetadata] = useState<SourceMetadata | null>(
    null,
  );
  const [preflightState, setPreflightState] = useState<
    "idle" | "loading" | "ok" | "error"
  >("idle");
  const [preflightError, setPreflightError] = useState<string | null>(null);
  const preflightAbortRef = useRef<AbortController | null>(null);
  const crawlAbortRef = useRef<AbortController | null>(null);
  const [includePatternsText, setIncludePatternsText] = useState("");
  const [excludePatternsText, setExcludePatternsText] = useState("");
  const [patternsAreRegex, setPatternsAreRegex] = useState(false);
  const [enableSitemap, setEnableSitemap] = useState(true);
  const [sitemapOnly, setSitemapOnly] = useState(false);
  const [sitemapUrlsText, setSitemapUrlsText] = useState("");
  const [maxPages, setMaxPages] = useState(DEFAULT_MAX_CRAWL_PAGES);
  const [renderJs, setRenderJs] = useState(false);
  const [contentSelectorsText, setContentSelectorsText] = useState(
    "article, main, .content",
  );
  const [excludeSelectorsText, setExcludeSelectorsText] = useState(
    "nav, footer, .sidebar, .toc",
  );
  // Enrichment/examples catalog kept experimental in packages — not exposed in web UI.
  const enrichExamples = false;

  const [sourceId, setSourceId] = useState<string | null>(
    isReplaceRecrawl ? replaceSourceIdParam : null,
  );
  const [versionResolution, setVersionResolution] =
    useState<VersionResolutionChoice | null>(
      isReplaceRecrawl && replaceSourceIdParam
        ? {
            mode: "replace",
            replaceSourceId: replaceSourceIdParam,
            versionLabel: "",
          }
        : null,
    );
  const [pendingDuplicate, setPendingDuplicate] =
    useState<SourceDuplicateMatch | null>(null);
  const [duplicateModalOpen, setDuplicateModalOpen] = useState(false);
  const [pendingCrawlAfterResolution, setPendingCrawlAfterResolution] =
    useState(false);
  const [crawlRun, setCrawlRun] = useState<CrawlRun | null>(null);
  const [parsePages, setParsePages] = useState<ParsePreviewPage[]>([]);
  const [activePreviewTab, setActivePreviewTab] = useState(0);
  const [selectedPreviewUrls, setSelectedPreviewUrls] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [copiedSelection, setCopiedSelection] = useState(false);
  const [ingestRunId, setIngestRunId] = useState<string | null>(null);
  const [ingestSnapshot, setIngestSnapshot] =
    useState<IngestPipelineSnapshot | null>(null);
  const [recentStartUrls, setRecentStartUrls] = useState<string[]>([]);
  const [crawlCardPhase, setCrawlCardPhase] = useState<CrawlCardPhase>("idle");
  const [liveCrawlCount, setLiveCrawlCount] = useState(0);
  const [step2EnterKey, setStep2EnterKey] = useState(0);
  const [reviewTab, setReviewTab] = useState<"urls" | "selectors" | "preview">(
    "urls",
  );
  const [indexEstimate, setIndexEstimate] = useState<IndexSizeEstimate | null>(
    null,
  );
  const [estimatingIndex, setEstimatingIndex] = useState(false);
  const crawlCompleteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const ingestCompleteRef = useRef(false);
  const lastUrlAnchorIndexRef = useRef<number | null>(null);
  const lastPathSegmentRef = useRef<string | null>(null);
  const catalogSelectionRef = useRef<string[]>([]);
  const refreshSelectStartedRef = useRef(false);
  const [refreshSelectReady, setRefreshSelectReady] = useState(false);
  const previewPersistRef = useRef({
    sourceId: null as string | null,
    ingestRunId: null as string | null,
    selectedPreviewUrls: [] as string[],
    parsePages: [] as ParsePreviewPage[],
    step: 1 as 1 | 2,
  });

  const config = useMemo<WebCrawlConfig>(
    () => ({
      ...DEFAULT_CONFIG(initialUrl),
      startUrls: buildStartUrls(primaryStartUrl, additionalStartUrls),
      includePatterns: linesToList(includePatternsText),
      excludePatterns: linesToList(excludePatternsText),
      patternsAreRegex,
      enableSitemap,
      sitemapOnly,
      sitemapUrls: linesToList(sitemapUrlsText).map(normalizeStartUrl),
      maxPages,
      renderJs,
      contentSelectors: selectorsToList(contentSelectorsText),
      excludeSelectors: selectorsToList(excludeSelectorsText),
    }),
    [
      initialUrl,
      primaryStartUrl,
      additionalStartUrls,
      includePatternsText,
      excludePatternsText,
      patternsAreRegex,
      enableSitemap,
      sitemapOnly,
      sitemapUrlsText,
      maxPages,
      renderJs,
      contentSelectorsText,
      excludeSelectorsText,
    ],
  );

  const discoveredUrls = crawlRun?.result?.urls ?? [];
  const skippedUrls = crawlRun?.result?.skipped ?? [];
  const { canonicalAliasCount, otherSkippedCount } = useMemo(
    () => partitionSkippedUrls(skippedUrls),
    [skippedUrls],
  );
  const totalUrlsSeen = discoveredUrls.length + canonicalAliasCount;
  const urlPathBreakdown = useMemo(
    () => groupDiscoveredUrlsByPath(discoveredUrls),
    [discoveredUrls],
  );
  const showUrlPathTags =
    config.startUrls.length > 1 || urlPathBreakdown.length > 1;

  previewPersistRef.current = {
    sourceId,
    ingestRunId,
    selectedPreviewUrls,
    parsePages,
    step,
  };

  const selectionPersistKey =
    selectedPreviewUrls.length <= MAX_STORED_SELECTION_URLS
      ? `${selectedPreviewUrls.length}:${selectedPreviewUrls[0] ?? ""}:${selectedPreviewUrls.at(-1) ?? ""}`
      : `count:${selectedPreviewUrls.length}`;

  const parsePersistKey = parsePages.map((page) => page.url).join("|");

  useEffect(() => {
    if (crawlCardPhase !== "crawling" || !sourceId) return;

    let cancelled = false;

    const poll = async () => {
      try {
        const progress = await getCrawlProgress(sourceId);
        if (!cancelled) {
          setLiveCrawlCount(progress.pagesDiscovered);
        }
      } catch {
        // Ignore transient poll errors while crawl is running.
      }
    };

    void poll();
    const interval = window.setInterval(poll, 750);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [crawlCardPhase, sourceId]);

  const { pipeline: displayPipeline } = useMemo(
    () =>
      resolveDisplayPipeline({
        snapshotPipeline: ingestSnapshot?.pipeline,
        busy,
        discoveredCount: discoveredUrls.length,
        maxPages: config.maxPages,
        selectedCount: selectedPreviewUrls.length,
        extractedCount: parsePages.length,
        chunkCount: ingestSnapshot?.result?.chunkCount,
      }),
    [
      ingestSnapshot?.pipeline,
      ingestSnapshot?.result?.chunkCount,
      busy,
      discoveredUrls.length,
      config.maxPages,
      selectedPreviewUrls.length,
      parsePages.length,
    ],
  );

  const pipelineAnimating = Boolean(busy);
  const toolbarLocked = Boolean(busy);
  const didInitialPreflight = useRef(false);

  useEffect(() => {
    setRecentStartUrls(loadRecentStartUrls());
  }, []);

  useEffect(() => {
    if (searchParams.get("fresh") !== "1") return;

    shouldRestoreSession.current = false;
    clearCrawlPreviewStorage(sourceScope);
    setStep(1);
    setSourceId(null);
    setCrawlRun(null);
    setParsePages([]);
    setSelectedPreviewUrls([]);
    setActivePreviewTab(0);
    setIngestRunId(null);
    setIngestSnapshot(null);
    setSaved(false);
    setError(null);
    setBusy(null);
    setCrawlCardPhase("idle");
    setReviewTab("urls");
    setPrimaryStartUrl("");
    setAdditionalStartUrls([]);
    setSourceName("");
    setPreflightOgImage(null);
    setPreflightFaviconUrl(null);
    setPreflightTitle("");
    setPreflightCheckedUrl("");
    setDiscoverySignals(null);
    setSourceMetadata(null);
    setPreflightState("idle");
    didInitialPreflight.current = false;

    const params = new URLSearchParams(searchParams.toString());
    params.delete("fresh");
    const query = params.toString();
    router.replace(query ? `/sources/web-crawl?${query}` : "/sources/web-crawl", {
      scroll: false,
    });
  }, [router, searchParams, sourceScope]);

  const runPreflight = useCallback(async (urlInput?: string) => {
    const url = normalizeStartUrl((urlInput ?? primaryStartUrl).trim());
    if (!url) return;

    try {
      new URL(url);
    } catch {
      return;
    }

    if (isPdfUrl(url)) {
      preflightAbortRef.current?.abort();
      setPreflightCheckedUrl(url);
      setSourceName(formatUrlLabel(url));
      setPreflightOgImage(null);
      setPreflightFaviconUrl(null);
      setPreflightTitle("");
      setDiscoverySignals(null);
      setSourceMetadata(null);
      setPreflightError(UNSUPPORTED_PDF_START_URL_MESSAGE);
      setPreflightState("error");
      return;
    }

    preflightAbortRef.current?.abort();
    const controller = new AbortController();
    preflightAbortRef.current = controller;

    setPreflightState("loading");
    setPreflightError(null);
    setPreflightOgImage(null);
    setPreflightFaviconUrl(null);
    setPreflightTitle("");
    setDiscoverySignals(null);
    setSourceMetadata(null);

    try {
      const customSitemaps = linesToList(sitemapUrlsText).map(normalizeStartUrl);
      const { preflight } = await preflightSite(
        url,
        controller.signal,
        customSitemaps,
      );
      setPreflightCheckedUrl(url);
      setSourceName(preflight.siteName);
      setPreflightOgImage(preflight.ogImage ?? null);
      setPreflightFaviconUrl(preflight.faviconUrl ?? null);
      setPreflightTitle(preflight.title ?? "");
      setDiscoverySignals(preflight.discovery);
      setSourceMetadata(preflight.metadata);
      if (preflight.ok) {
        setPreflightError(null);
        setPreflightState("ok");
      } else {
        setPreflightError(formatPreflightHttpError(preflight.status));
        setPreflightState("error");
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      setPreflightCheckedUrl(url);
      setSourceName(formatUrlLabel(url));
      setPreflightOgImage(null);
      setPreflightFaviconUrl(null);
      setPreflightTitle("");
      setDiscoverySignals(null);
      setSourceMetadata(null);
      setPreflightError(formatPreflightError(error));
      setPreflightState("error");
    }
  }, [primaryStartUrl, sitemapUrlsText]);

  useEffect(() => {
    if (isReplaceRecrawl) return;
    setVersionResolution(null);
    setPendingDuplicate(null);
    setDuplicateModalOpen(false);
  }, [primaryStartUrl, isReplaceRecrawl]);

  useEffect(() => {
    if (!initialUrl || didInitialPreflight.current || isRefreshSelect) return;
    didInitialPreflight.current = true;
    void runPreflight(initialUrl);
  }, [initialUrl, isRefreshSelect, runPreflight]);

  useEffect(() => {
    if (!isRefreshSelect || !refreshSelectSourceIdParam) return;

    let cancelled = false;

    void (async () => {
      try {
        const [{ source }, catalogResult] = await Promise.all([
          getSource(refreshSelectSourceIdParam),
          getMetadataCatalog(refreshSelectSourceIdParam).catch(() => ({
            catalog: null,
          })),
        ]);
        if (cancelled) return;

        catalogSelectionRef.current =
          catalogResult.catalog?.pages.map((page) => page.url) ?? [];

        const cfg = source.config;
        const [primary, ...rest] = cfg.startUrls;
        setSourceId(source.id);
        setSourceName(source.name);
        setPrimaryStartUrl(primary ?? "");
        setAdditionalStartUrls(rest);
        setIncludePatternsText(cfg.includePatterns.join("\n"));
        setExcludePatternsText(cfg.excludePatterns.join("\n"));
        setPatternsAreRegex(cfg.patternsAreRegex);
        setEnableSitemap(cfg.enableSitemap);
        setSitemapOnly(cfg.sitemapOnly ?? false);
        setSitemapUrlsText((cfg.sitemapUrls ?? []).join("\n"));
        setMaxPages(cfg.maxPages);
        setRenderJs(cfg.renderJs);
        setContentSelectorsText(cfg.contentSelectors.join(", "));
        setExcludeSelectorsText(cfg.excludeSelectors.join(", "));
        setPreflightOgImage(source.ogImageUrl ?? null);
        setPreflightFaviconUrl(source.faviconUrl ?? null);
        setSourceMetadata(source.sourceMetadata ?? null);
        setPreflightState("ok");
        setPreflightCheckedUrl(primary ?? "");
        setRefreshSelectReady(true);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to load source for refresh",
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isRefreshSelect, refreshSelectSourceIdParam]);

  useEffect(() => {
    const url = normalizeStartUrl(primaryStartUrl.trim());
    if (!url) {
      setPreflightState("idle");
      setPreflightError(null);
      setPreflightOgImage(null);
      setPreflightFaviconUrl(null);
      setPreflightTitle("");
      setPreflightCheckedUrl("");
      setDiscoverySignals(null);
      setSourceMetadata(null);
      return;
    }

    if (isPdfUrl(url)) {
      setPreflightCheckedUrl(url);
      setPreflightOgImage(null);
      setPreflightFaviconUrl(null);
      setPreflightTitle("");
      setDiscoverySignals(null);
      setSourceMetadata(null);
      setPreflightError(UNSUPPORTED_PDF_START_URL_MESSAGE);
      setPreflightState("error");
      return;
    }

    if (preflightCheckedUrl && url !== preflightCheckedUrl) {
      setPreflightState("idle");
      setPreflightError(null);
      setPreflightOgImage(null);
      setPreflightFaviconUrl(null);
      setPreflightTitle("");
      setDiscoverySignals(null);
      setSourceMetadata(null);
    }
  }, [primaryStartUrl, preflightCheckedUrl]);

  useEffect(() => {
    if (!shouldRestoreSession.current) return;

    let cancelled = false;

    async function restoreCrawlPreview() {
      try {
        const raw = readCrawlPreviewStorage(sourceScope);
        if (!raw) return;

        const stored = JSON.parse(raw) as
          | StoredCrawlPreviewV3
          | StoredCrawlPreviewV2
          | StoredCrawlPreviewLegacy;

        const resolvedSourceId =
          "sourceId" in stored && stored.sourceId
            ? stored.sourceId
            : (stored as StoredCrawlPreviewLegacy).crawlRun?.sourceId;
        const resolvedRunId =
          "ingestRunId" in stored && stored.ingestRunId
            ? stored.ingestRunId
            : "crawlRunId" in stored && stored.crawlRunId
              ? stored.crawlRunId
              : (stored as StoredCrawlPreviewLegacy).crawlRun?.id;
        const storedSelection = normalizeStoredSelection(
          "selectedPreviewUrls" in stored ? stored.selectedPreviewUrls : [],
        );
        const storedStep =
          "step" in stored && (stored.step === 1 || stored.step === 2)
            ? stored.step
            : 2;

        if (resolvedSourceId && resolvedRunId) {
          const hasLocalRestore =
            ("parsePageSummaries" in stored &&
              Boolean(stored.parsePageSummaries?.length)) ||
            (storedStep === 2 && storedSelection.length > 0);

          if (hasLocalRestore) {
            try {
              await getSource(resolvedSourceId);
              if (cancelled) return;

              setSourceId(resolvedSourceId);
              if (
                "parsePageSummaries" in stored &&
                stored.parsePageSummaries?.length
              ) {
                setParsePages(parsePageSummariesToPreview(stored.parsePageSummaries));
                setActivePreviewTab(0);
              }
              if (storedSelection.length > 0) {
                setSelectedPreviewUrls(storedSelection);
              }
              setStep(storedStep);
              return;
            } catch {
              clearCrawlPreviewStorage(sourceScope);
            }
          }

          const snapshot = await tryGetIngestWorkflowStatus(
            resolvedSourceId,
            resolvedRunId,
          );
          if (cancelled) return;

          if (snapshot) {
            const restoredCrawlRun = crawlRunFromCrawlReviewSnapshot(
              snapshot,
              resolvedSourceId,
            );
            const restoredParsePages = parsePagesFromParseReviewSnapshot(snapshot);

            setSourceId(resolvedSourceId);
            setIngestRunId(resolvedRunId);
            setIngestSnapshot(snapshot);

            if (restoredCrawlRun) {
              setCrawlRun(restoredCrawlRun);
              setSelectedPreviewUrls(
                reconcilePreviewSelection(
                  restoredCrawlRun.result!.urls!,
                  storedSelection,
                ),
              );
            }

            if (restoredParsePages.length > 0) {
              setParsePages(restoredParsePages);
              setActivePreviewTab(0);
            } else if (
              "parsePageSummaries" in stored &&
              stored.parsePageSummaries?.length
            ) {
              setParsePages(parsePageSummariesToPreview(stored.parsePageSummaries));
            }

            setStep(restoredCrawlRun || restoredParsePages.length > 0 ? storedStep : 1);
            return;
          }

          clearCrawlPreviewStorage(sourceScope);
        }

        if ("v" in stored && stored.v === 2 && stored.crawlRunId) {
          try {
            const { crawlRun: restoredCrawlRun } = await getCrawlRun(stored.crawlRunId);
            if (cancelled || !restoredCrawlRun?.result?.urls?.length) return;

            setSourceId(stored.sourceId);
            setCrawlRun(restoredCrawlRun);
            setSelectedPreviewUrls(
              reconcilePreviewSelection(
                restoredCrawlRun.result.urls,
                storedSelection,
              ),
            );
            setParsePages(
              stored.parsePageSummaries
                ? parsePageSummariesToPreview(stored.parsePageSummaries)
                : [],
            );
            setStep(stored.step ?? 2);
          } catch {
            clearCrawlPreviewStorage(sourceScope);
          }
          return;
        }

        const legacy = stored as StoredCrawlPreviewLegacy;
        if (!legacy.crawlRun?.result?.urls?.length) return;
        if (cancelled) return;

        setSourceId(legacy.crawlRun.sourceId);
        setCrawlRun(legacy.crawlRun);
        const urls = legacy.crawlRun.result.urls;
        setSelectedPreviewUrls(
          reconcilePreviewSelection(urls, storedSelection),
        );
        setParsePages(legacy.parsePages ?? []);
        setStep(storedStep);

        if (legacy.crawlRun.sourceId && legacy.crawlRun.id) {
          persistCrawlPreview({
            scope: sourceScope,
            sourceId: legacy.crawlRun.sourceId,
            ingestRunId: legacy.crawlRun.id,
            selectedPreviewUrls: storedSelection,
            parsePages: legacy.parsePages ?? [],
            step: storedStep,
          });
        }
      } catch {
        clearCrawlPreviewStorage(sourceScope);
      }
    }

    void restoreCrawlPreview();

    return () => {
      cancelled = true;
    };
  }, [sourceScope]);

  useEffect(() => {
    if (!crawlRun?.result?.urls?.length || !sourceId || !ingestRunId) return;

    const timer = window.setTimeout(() => {
      const current = previewPersistRef.current;
      if (!current.sourceId || !current.ingestRunId) return;

      persistCrawlPreview({
        scope: sourceScope,
        sourceId: current.sourceId,
        ingestRunId: current.ingestRunId,
        selectedPreviewUrls: current.selectedPreviewUrls,
        parsePages: current.parsePages,
        step: current.step,
      });
    }, 250);

    return () => window.clearTimeout(timer);
  }, [
    sourceScope,
    crawlRun?.id,
    sourceId,
    ingestRunId,
    step,
    selectionPersistKey,
    parsePersistKey,
  ]);

  const finishIngestFromSnapshot = useCallback(
    (snapshot: IngestPipelineSnapshot, id: string) => {
      if (ingestCompleteRef.current) return;
      ingestCompleteRef.current = true;
      setBusy(null);
      setSaved(true);
      setIngestSnapshot(snapshot);
      router.push(dashboardIndexRedirectUrl(id, sourceScope));
    },
    [router, sourceScope],
  );

  useEffect(() => {
    if (busy !== "save" || !ingestRunId || !sourceId) return;

    let cancelled = false;

    const poll = async () => {
      try {
        const { snapshot } = await getIngestWorkflowStatus(sourceId, ingestRunId);
        if (cancelled || !snapshot) return;
        setIngestSnapshot(snapshot);
        if (snapshot.status === "success") {
          finishIngestFromSnapshot(snapshot, sourceId);
        }
      } catch (error) {
        if (
          error instanceof KnowledgeIndexApiError &&
          error.status === 404
        ) {
          if (cancelled) return;
          setIngestRunId(null);
          setBusy(null);
          clearCrawlPreviewStorage(sourceScope);
          setError("Ingest session expired. Restart indexing to continue.");
        }
      }
    };

    void poll();
    const interval = window.setInterval(() => {
      void poll();
    }, 800);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [busy, ingestRunId, sourceId, sourceScope, finishIngestFromSnapshot]);

  useEffect(() => {
    if (!crawlRun?.result?.urls?.length) return;

    setSelectedPreviewUrls((current) => {
      const next = reconcilePreviewSelection(crawlRun.result!.urls!, current);
      const unchanged =
        next.length === current.length &&
        next.every((url, index) => url === current[index]);
      return unchanged ? current : next;
    });
  }, [crawlRun?.id]);

  useEffect(() => {
    return () => {
      if (crawlCompleteTimerRef.current) {
        clearTimeout(crawlCompleteTimerRef.current);
      }
    };
  }, []);

  function scheduleStep2Transition() {
    if (crawlCompleteTimerRef.current) {
      clearTimeout(crawlCompleteTimerRef.current);
    }

    crawlCompleteTimerRef.current = setTimeout(() => {
      setStep2EnterKey((key) => key + 1);
      setStep(2);
      setCrawlCardPhase("idle");
      crawlCompleteTimerRef.current = null;
    }, 720);
  }

  function versionCreatePayload() {
    if (!versionResolution) return {};
    return {
      versionMode: versionResolution.mode,
      replaceSourceId: versionResolution.replaceSourceId,
      versionLabel: versionResolution.versionLabel || undefined,
    };
  }

  function metadataWithVersionLabel(): SourceMetadata | undefined {
    if (!sourceMetadata) return undefined;
    if (!versionResolution?.versionLabel) return sourceMetadata;
    return { ...sourceMetadata, version: versionResolution.versionLabel };
  }

  async function createDraftSource() {
    const sourceMetadataPayload = metadataWithVersionLabel();
    const hosting: SourceHosting =
      sourceScope === "global" || !hostingCaps.localAvailable
        ? "cloud"
        : sourceHosting;
    syncApiBaseForHosting({ scope: sourceScope, hosting });
    const createInput = {
      name: resolveSourceName(sourceName, primaryStartUrl),
      scope: sourceScope as "personal" | "global",
      hosting,
      config,
      ...(sourceMetadataPayload
        ? { sourceMetadata: sourceMetadataPayload }
        : {}),
      ...versionCreatePayload(),
    };

    if (sourceScope === "global") {
      const { source } = await createSource(createInput);
      setSourceId(source.id);
      return source.id;
    }

    let resolvedProjectId = getDevProjectId();

    if (!resolvedProjectId) {
      const { project } = await createProject("My LedgeIndex project");
      resolvedProjectId = project.id;
      setDevProjectId(project.id);
    }

    try {
      const { source } = await createSource({
        ...createInput,
        projectId: resolvedProjectId,
      });
      setSourceId(source.id);
      return source.id;
    } catch (error) {
      if (
        error instanceof KnowledgeIndexApiError &&
        error.status === 404 &&
        resolvedProjectId
      ) {
        const { project } = await createProject("My LedgeIndex project");
        setDevProjectId(project.id);
        const { source } = await createSource({
          ...createInput,
          projectId: project.id,
        });
        setSourceId(source.id);
        return source.id;
      }
      throw error;
    }
  }

  async function ensureSource() {
    if (versionResolution?.mode === "replace" && versionResolution.replaceSourceId) {
      return createDraftSource();
    }

    if (sourceId) {
      try {
        await getSource(sourceId);
        return sourceId;
      } catch (error) {
        if (!(error instanceof KnowledgeIndexApiError) || error.status !== 404) {
          throw error;
        }
        setSourceId(null);
      }
    }

    return createDraftSource();
  }

  async function resolveDuplicateIfNeeded(): Promise<boolean> {
    if (versionResolution || sourceId) return true;

    const url = normalizeStartUrl(primaryStartUrl.trim());
    if (!url) return true;

    const { duplicate } = await checkSourceDuplicates({
      url,
      scope: sourceScope,
      versionLabel: sourceMetadata?.version ?? undefined,
    });

    if (!duplicate) return true;

    setPendingDuplicate(duplicate);
    setDuplicateModalOpen(true);
    return false;
  }

  function handleVersionResolutionConfirm(choice: VersionResolutionChoice) {
    setVersionResolution(choice);
    setDuplicateModalOpen(false);
    setPendingDuplicate(null);

    if (pendingCrawlAfterResolution) {
      setPendingCrawlAfterResolution(false);
      void handleCrawlPreview();
    }
  }

  function handleVersionResolutionCancel() {
    setDuplicateModalOpen(false);
    setPendingDuplicate(null);
    setPendingCrawlAfterResolution(false);
    setBusy(null);
    setCrawlCardPhase("idle");
  }

  /** Abandon crawl review / crashed session and return to the start screen. */
  function handleCancelCrawlReview() {
    shouldRestoreSession.current = false;
    clearCrawlPreviewStorage(sourceScope);
    setStep(1);
    setSourceId(null);
    setCrawlRun(null);
    setParsePages([]);
    setSelectedPreviewUrls([]);
    setActivePreviewTab(0);
    setIngestRunId(null);
    setIngestSnapshot(null);
    setSaved(false);
    setError(null);
    setBusy(null);
    setCrawlCardPhase("idle");
    setReviewTab("urls");
    setStep2EnterKey((key) => key + 1);
  }

  async function applyIngestSnapshot(
    snapshot: IngestPipelineSnapshot,
    id: string,
  ) {
    setIngestSnapshot(snapshot);
    setIngestRunId(snapshot.runId);

    if (snapshot.status === "success") {
      finishIngestFromSnapshot(snapshot, id);
      return;
    }

    if (snapshot.suspendedStep === "crawl-review-step") {
      const payload = snapshot.suspendPayload as {
        urls?: { url: string; title?: string }[];
        skipped?: { url: string; reason: string }[];
        pagesDiscovered?: number;
      };

      const urls = payload.urls ?? [];
      setCrawlRun({
        id: snapshot.runId,
        sourceId: id,
        kind: "preview",
        status: "completed",
        pagesDiscovered: payload.pagesDiscovered ?? urls.length,
        result: {
          urls,
          skipped: payload.skipped ?? [],
        },
      });

      if (urls.length > 0) {
        setSelectedPreviewUrls((current) =>
          reconcilePreviewSelection(
            urls,
            isRefreshSelect && catalogSelectionRef.current.length > 0
              ? catalogSelectionRef.current
              : current,
          ),
        );
      } else {
        setSelectedPreviewUrls([]);
      }

      setCrawlCardPhase("complete");
      scheduleStep2Transition();
    }

    if (snapshot.suspendedStep === "parse-review-step") {
      const payload = snapshot.suspendPayload as {
        pages?: ParsePreviewPage[];
      };
      if (payload.pages?.length) {
        setParsePages(payload.pages);
        setActivePreviewTab(0);
      }
      setStep(2);
    }

    if (snapshot.status === "failed" && snapshot.error) {
      setError(snapshot.error);
    }
  }

  function selectUrlsForPathSegment(segment: string, event: ReactMouseEvent<HTMLButtonElement>) {
    const segmentUrls = filterUrlsByPathSegment(discoveredUrls, segment);
    const segments = urlPathBreakdown.map((group) => group.segment);

    if (event.shiftKey && lastPathSegmentRef.current) {
      const lastIndex = segments.indexOf(lastPathSegmentRef.current);
      const currentIndex = segments.indexOf(segment);
      if (lastIndex >= 0 && currentIndex >= 0) {
        const start = Math.min(lastIndex, currentIndex);
        const end = Math.max(lastIndex, currentIndex);
        const rangeUrls = collectUrlsForPathSegments(
          discoveredUrls,
          segments.slice(start, end + 1),
        );
        setSelectedPreviewUrls((current) => [
          ...new Set([...current, ...rangeUrls]),
        ]);
        lastPathSegmentRef.current = segment;
        setIndexEstimate(null);
        return;
      }
    }

    const state = getPathSegmentSelectionState(
      discoveredUrls,
      segment,
      selectedPreviewUrls,
    );

    setSelectedPreviewUrls((current) => {
      if (state === "all") {
        const remove = new Set(segmentUrls);
        return current.filter((url) => !remove.has(url));
      }
      return [...new Set([...current, ...segmentUrls])];
    });
    lastPathSegmentRef.current = segment;
    setIndexEstimate(null);
  }

  async function handleEstimateIndexSize() {
    if (selectedPreviewUrls.length === 0) return;
    setEstimatingIndex(true);
    setError(null);
    try {
      const id = await ensureSource();
      const sample = sampleUrlsEvenly(
        selectedPreviewUrls,
        INDEX_ESTIMATE_SAMPLE_LIMIT,
      );
      const { estimate } = await estimateIndexSize(id, {
        urls: sample,
        selectedUrlCount: selectedPreviewUrls.length,
        contentSelectors: config.contentSelectors,
        excludeSelectors: config.excludeSelectors,
      });
      setIndexEstimate(estimate);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to estimate index size",
      );
    } finally {
      setEstimatingIndex(false);
    }
  }

  function abortCrawl() {
    crawlAbortRef.current?.abort();
    crawlAbortRef.current = null;
    if (sourceId) {
      void cancelIngestCrawl(sourceId).catch(() => {
        // Ignore — crawl may already be finished.
      });
    }
    if (crawlCompleteTimerRef.current) {
      clearTimeout(crawlCompleteTimerRef.current);
      crawlCompleteTimerRef.current = null;
    }
    setCrawlCardPhase("idle");
    setBusy(null);
    setError("Crawl cancelled");
  }

  function abortIndex() {
    if (!sourceId) return;
    void cancelIngestCrawl(sourceId).catch(() => {
      // Ignore — indexing may already be finished.
    });
    ingestCompleteRef.current = false;
    setBusy(null);
    setError("Indexing cancelled");
  }

  async function handleCrawlPreview() {
    if (config.startUrls.length === 0) {
      setError("Add at least one start URL before running crawl preview.");
      return;
    }

    const pdfStartUrl = config.startUrls.find((url) => isPdfUrl(url));
    if (pdfStartUrl) {
      setError(UNSUPPORTED_PDF_START_URL_MESSAGE);
      return;
    }

    setError(null);
    setBusy("crawl");
    setCrawlCardPhase("crawling");
    setLiveCrawlCount(0);
    setSelectedPreviewUrls([]);
    setReviewTab("urls");
    setRecentStartUrls(rememberStartUrls(config.startUrls));

    crawlAbortRef.current?.abort();
    const controller = new AbortController();
    crawlAbortRef.current = controller;

    try {
      const canProceed = await resolveDuplicateIfNeeded();
      if (!canProceed) {
        setPendingCrawlAfterResolution(true);
        setBusy(null);
        setCrawlCardPhase("idle");
        return;
      }

      const id = await ensureSource();
      const sourceMetadataPayload = metadataWithVersionLabel();
      await updateSource(id, {
        name: resolveSourceName(sourceName, primaryStartUrl),
        config,
        ogImageUrl: preflightOgImage,
        faviconUrl: preflightFaviconUrl,
        ...(sourceMetadataPayload
          ? { sourceMetadata: sourceMetadataPayload }
          : {}),
      });
      const { snapshot } = await startIngestWorkflow(
        id,
        { config },
        controller.signal,
      );
      await applyIngestSnapshot(snapshot, id);

      if (snapshot.suspendedStep === "crawl-review-step") {
        const payload = snapshot.suspendPayload as {
          urls?: { url: string }[];
          skipped?: { url: string; reason: string }[];
        };
        if ((payload.urls?.length ?? 0) === 0) {
          const firstReason = payload.skipped?.[0]?.reason;
          setError(
            enableSitemap
              ? `No pages discovered.${firstReason ? ` ${payload.skipped?.[0]?.url}: ${firstReason}` : ""}`
              : `No pages discovered without sitemap. Try a deeper docs URL, enable sitemap discovery, or loosen include/exclude patterns.${firstReason ? ` First issue: ${firstReason}` : ""}`,
          );
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      setCrawlCardPhase("idle");
      setError(err instanceof Error ? err.message : "Crawl failed");
    } finally {
      if (crawlAbortRef.current === controller) {
        crawlAbortRef.current = null;
      }
      setBusy(null);
    }
  }

  useEffect(() => {
    if (!isRefreshSelect || !refreshSelectReady || refreshSelectStartedRef.current) {
      return;
    }
    if (config.startUrls.length === 0) return;

    refreshSelectStartedRef.current = true;
    void handleCrawlPreview();
  }, [isRefreshSelect, refreshSelectReady, config.startUrls]);

  async function handleContinueToExtraction() {
    if (selectedPreviewUrls.length === 0) return;
    setError(null);
    setBusy("parse");
    try {
      const id = await ensureSource();
      await updateSource(id, {
        config,
        ogImageUrl: preflightOgImage,
        faviconUrl: preflightFaviconUrl,
        sourceMetadata,
      });

      const previewUrls = pickRandomSample(
        selectedPreviewUrls,
        PARSE_PREVIEW_URL_LIMIT,
      );

      const { pages } = await runParsePreview(id, {
        urls: previewUrls,
        contentSelectors: config.contentSelectors,
        excludeSelectors: config.excludeSelectors,
      });
      setParsePages(pages);
      setActivePreviewTab(0);
      setReviewTab("preview");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Extraction preview failed");
    } finally {
      setBusy(null);
    }
  }

  async function handleIndexAndSave() {
    setError(null);
    ingestCompleteRef.current = false;
    setBusy("save");
    try {
      const id = await ensureSource();
      await updateSource(id, {
        name: resolveSourceName(sourceName, primaryStartUrl),
        config,
        ogImageUrl: preflightOgImage,
        faviconUrl: preflightFaviconUrl,
        sourceMetadata,
      });

      if (ingestRunId) {
        try {
          let suspendedStep = ingestSnapshot?.suspendedStep;

          if (suspendedStep === "crawl-review-step") {
            if (selectedPreviewUrls.length === 0) {
              setError("Select at least one URL before indexing.");
              return;
            }

            const { snapshot: extractSnapshot } = await resumeIngestWorkflow(
              id,
              ingestRunId,
              {
                step: "crawl-review-step",
                resumeData: {
                  selectedUrls: selectedPreviewUrls,
                  enrichExamples,
                },
              },
            );
            await applyIngestSnapshot(extractSnapshot, id);
            suspendedStep = extractSnapshot.suspendedStep;

            if (extractSnapshot.status === "success") {
              return;
            }
          }

          if (suspendedStep === "parse-review-step") {
            const { snapshot: enrichSnapshot } = await resumeIngestWorkflow(
              id,
              ingestRunId,
              {
                step: "parse-review-step",
                resumeData: { confirmed: true, enrichExamples },
              },
            );
            await applyIngestSnapshot(enrichSnapshot, id);
            suspendedStep = enrichSnapshot.suspendedStep;

            if (enrichSnapshot.status === "success") {
              return;
            }
          }

          if (suspendedStep === "enrich-step") {
            const { snapshot: indexSnapshot } = await resumeIngestWorkflow(
              id,
              ingestRunId,
              {
                step: "enrich-step",
                resumeData: { confirmed: true },
              },
            );
            await applyIngestSnapshot(indexSnapshot, id);
            return;
          }
        } catch (workflowError) {
          const message =
            workflowError instanceof Error
              ? workflowError.message
              : "Ingest workflow failed";
          const runLost = message.includes("Ingest run not found");
          if (!runLost || parsePages.length === 0) {
            throw workflowError;
          }
          setError(
            "Ingest session expired — indexing from extracted preview pages instead.",
          );
        }
      }

      const pagesToIndex = parsePages.filter((page) => page.markdown.trim().length > 0);
      if (pagesToIndex.length > 0) {
        await indexPreviewPages(
          id,
          pagesToIndex.map((page) => ({
            url: page.url,
            title: page.title || page.url,
            markdown: page.markdown,
          })),
        );
        setSaved(true);
        router.push(dashboardIndexRedirectUrl(id, sourceScope));
        return;
      }

      if (selectedPreviewUrls.length > 0) {
        setError(
          "No extracted content yet. Use Preview to inspect extraction, or Index & save to index all selected pages.",
        );
        return;
      }

      setError("Nothing to index yet. Run crawl and select URLs first.");
    } catch (err) {
      if (
        err instanceof KnowledgeIndexApiError &&
        (err.status === 499 || err.message.toLowerCase().includes("cancelled"))
      ) {
        setError("Indexing cancelled");
      } else {
        setError(err instanceof Error ? err.message : "Save failed");
      }
    } finally {
      setBusy(null);
    }
  }

  function handlePreviewUrlClick(
    index: number,
    url: string,
    event: ReactMouseEvent<HTMLButtonElement>,
  ) {
    if (event.shiftKey && lastUrlAnchorIndexRef.current != null) {
      const start = Math.min(lastUrlAnchorIndexRef.current, index);
      const end = Math.max(lastUrlAnchorIndexRef.current, index);
      const rangeUrls = discoveredUrls
        .slice(start, end + 1)
        .map((item) => item.url);
      setSelectedPreviewUrls(rangeUrls);
    } else {
      setSelectedPreviewUrls((current) => {
        if (current.includes(url)) {
          return current.filter((item) => item !== url);
        }
        return [...current, url];
      });
      lastUrlAnchorIndexRef.current = index;
    }
    setIndexEstimate(null);
  }

  function selectAllPreviewUrls() {
    setSelectedPreviewUrls(discoveredUrls.map((item) => item.url));
    lastUrlAnchorIndexRef.current = null;
    lastPathSegmentRef.current = null;
    setIndexEstimate(null);
  }

  function clearPreviewSelection() {
    setSelectedPreviewUrls([]);
    lastUrlAnchorIndexRef.current = null;
    lastPathSegmentRef.current = null;
    setIndexEstimate(null);
  }

  async function copySelectedUrls() {
    if (selectedPreviewUrls.length === 0) return;

    try {
      await navigator.clipboard.writeText(selectedPreviewUrls.join("\n"));
      setCopiedSelection(true);
      window.setTimeout(() => setCopiedSelection(false), 2000);
    } catch {
      setError("Could not copy URLs to clipboard");
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      {error ? (
        <div className="shrink-0 border-b border-red-500/25 bg-red-500/8 px-4 py-2 sm:px-6">
          <p className="mx-auto max-w-[90rem] text-sm text-red-700 dark:text-red-300">
            {error}
          </p>
        </div>
      ) : null}

      <div className="relative z-30 shrink-0 border-b border-border/40 bg-background/90 px-3 py-2 backdrop-blur-sm sm:px-6 sm:py-2.5">
        <div className="mx-auto w-full min-w-0 max-w-[90rem]">
          <div className="relative flex min-w-0 items-center justify-center">
            <div className="absolute left-0 top-1/2 z-10 -translate-y-1/2">
              <MobileMenuButton />
            </div>
            <div className="flex min-w-0 max-w-full items-center justify-center overflow-x-auto px-11 [-ms-overflow-style:none] [scrollbar-width:none] sm:px-12 [&::-webkit-scrollbar]:hidden">
            <div className="inline-flex min-w-0 items-center gap-px rounded-xl border border-border bg-surface-raised/80 p-0.5 shadow-card">
            <ConfigPill
              label="Scope"
              icon={<ScopeIcon />}
              compactSummary={`${maxPages}`}
              summary={`${maxPages} pages${patternsAreRegex ? " · regex" : ""}`}
              description="Crawls only pages at or below your start URL path, plus optional filters."
              disabled={toolbarLocked}
            >
              <div className={cn(configPanelInsetClass, "space-y-4")}>
                <div>
                  <label className={configFieldLabelClass}>Max pages</label>
                  <input
                    type="number"
                    min={1}
                    max={MAX_CRAWL_PAGES}
                    value={maxPages}
                    onChange={(e) =>
                      setMaxPages(
                        Math.min(
                          MAX_CRAWL_PAGES,
                          Math.max(1, Number(e.target.value) || 1),
                        ),
                      )
                    }
                    className="field-input w-full font-mono text-xs"
                  />
                </div>
                <div>
                  <label className={configFieldLabelClass}>Pattern matching</label>
                  <Segmented
                    value={patternsAreRegex ? "regex" : "literal"}
                    onChange={(value) => setPatternsAreRegex(value === "regex")}
                    options={[
                      { value: "literal", label: "Literal" },
                      { value: "regex", label: "Regex" },
                    ]}
                  />
                </div>
                <div>
                  <label className={configFieldLabelClass}>Include URLs</label>
                  <textarea
                    value={includePatternsText}
                    onChange={(e) => setIncludePatternsText(e.target.value)}
                    rows={2}
                    spellCheck={false}
                    className="field-input w-full font-mono text-xs leading-5"
                    placeholder="Optional — e.g. /docs/api/"
                  />
                </div>
                <div>
                  <label className={configFieldLabelClass}>Exclude URLs</label>
                  <textarea
                    value={excludePatternsText}
                    onChange={(e) => setExcludePatternsText(e.target.value)}
                    rows={2}
                    spellCheck={false}
                    className="field-input w-full font-mono text-xs leading-5"
                    placeholder="/changelog/"
                  />
                </div>
              </div>
            </ConfigPill>

            <ToolbarDivider />

            <ConfigPill
              label="Discovery"
              icon={<DiscoveryIcon />}
              compactSummary={
                enableSitemap
                  ? sitemapOnly
                    ? "Sitemap only"
                    : "Sitemap + links"
                  : "Links"
              }
              summary={
                enableSitemap
                  ? sitemapOnly
                    ? "Sitemap only"
                    : "Sitemap + link crawl"
                  : "Links only"
              }
              description="Sitemap adds known URLs. Link crawl follows in-scope HTML links from your start URL."
              disabled={toolbarLocked}
            >
              <div className={configPanelInsetClass}>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-foreground">
                    Sitemap discovery
                  </p>
                  <p className="mt-0.5 text-xs text-muted">
                    Read sitemap.xml, filtered to your start URL path
                  </p>
                </div>
                <Switch
                  checked={enableSitemap}
                  onChange={setEnableSitemap}
                  label="Enable sitemap discovery"
                />
              </div>
              {enableSitemap ? (
                <div className="mt-4 space-y-4 border-t border-border/60 pt-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        Sitemap only
                      </p>
                      <p className="mt-0.5 text-xs text-muted">
                        Skip link crawling — use sitemap URLs only (faster)
                      </p>
                    </div>
                    <Switch
                      checked={sitemapOnly}
                      onChange={setSitemapOnly}
                      label="Sitemap only discovery"
                    />
                  </div>
                  <div>
                  <label className={configFieldLabelClass}>
                    Custom sitemap URLs
                  </label>
                  <textarea
                    value={sitemapUrlsText}
                    onChange={(e) => setSitemapUrlsText(e.target.value)}
                    rows={2}
                    spellCheck={false}
                    className="field-input w-full font-mono text-xs leading-5"
                    placeholder="https://docs.example.com/sitemap.xml"
                  />
                  </div>
                </div>
              ) : null}
              </div>
            </ConfigPill>

            <ToolbarDivider />

            <ConfigPill
              label="Rendering"
              icon={<RenderingIcon />}
              compactSummary={renderJs ? "JS" : "Off"}
              summary={renderJs ? "JavaScript on" : "Static HTML"}
              description="Headless browser for client-rendered sites."
              disabled={toolbarLocked}
            >
              <div className={configPanelInsetClass}>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      Render JavaScript
                    </p>
                    <p className="mt-0.5 text-xs text-muted">
                      Slower crawls — not available yet
                    </p>
                  </div>
                  <Switch
                    checked={renderJs}
                    onChange={setRenderJs}
                    label="Render JavaScript"
                    disabled
                  />
                </div>
              </div>
            </ConfigPill>
            </div>
            </div>

          </div>
        </div>
      </div>

      {/* ─── Main content ─────────────────────────────────────── */}
      <div
        className={cn(
          "relative z-0 mx-auto flex min-h-0 w-full min-w-0 max-w-[90rem] flex-1 flex-col overflow-hidden",
          step === 2 && "px-4 py-2 sm:px-6 sm:py-3",
        )}
      >
        {step === 1 ? (
          <div className="flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto overscroll-contain px-4 py-3 sm:px-6 sm:py-4 lg:items-center lg:justify-center lg:overflow-hidden">
            <StartUrlCard
            primaryStartUrl={primaryStartUrl}
            onPrimaryStartUrlChange={setPrimaryStartUrl}
            additionalStartUrls={additionalStartUrls}
            onAdditionalStartUrlsChange={setAdditionalStartUrls}
            recentStartUrls={recentStartUrls}
            preflightState={preflightState}
            preflightError={preflightError}
            sourceName={sourceName}
            preflightTitle={preflightTitle}
            preflightOgImage={preflightOgImage}
            preflightFaviconUrl={preflightFaviconUrl}
            preflightCheckedUrl={preflightCheckedUrl}
            discoverySignals={discoverySignals}
            sourceMetadata={sourceMetadata}
            maxPages={maxPages}
            enableSitemap={enableSitemap}
            onCheckSite={runPreflight}
            busy={busy}
            crawlCardPhase={crawlCardPhase}
            pagesDiscovered={
              crawlCardPhase === "crawling"
                ? liveCrawlCount
                : discoveredUrls.length
            }
            onSubmit={handleCrawlPreview}
            isAdmin={isAdmin}
            sourceScope={sourceScope}
            onScopeChange={handleScopeChange}
            sourceHosting={sourceHosting}
            onHostingChange={setSourceHosting}
            showHostingToggle={
              sourceScope === "personal" && hostingCaps.localAvailable
            }
            toolbarLocked={toolbarLocked}
            onAbortCrawl={abortCrawl}
          />
          </div>
        ) : (
          <div
            key={step2EnterKey}
            className="animate-crawl-results-enter mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col overflow-hidden py-2"
          >
            <WidgetPanel
              fillHeight
              headerStatus="ready"
              headerLabel="Crawl review"
              headerLeadingAside={
                <button
                  type="button"
                  onClick={handleCancelCrawlReview}
                  disabled={busy === "save"}
                  className="inline-flex h-7 shrink-0 items-center rounded-md border border-border bg-card-solid px-2.5 font-mono text-[0.5rem] font-semibold tracking-[0.08em] text-muted uppercase transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Cancel
                </button>
              }
              headerCenterAside={
                <div className="flex shrink-0 items-center gap-1.5">
                  {reviewTab === "preview" && parsePages.length > 0 ? (
                    <PreviewSampleBadges
                      pages={parsePages}
                      activeIndex={activePreviewTab}
                      onSelect={setActivePreviewTab}
                    />
                  ) : null}
                  <Segmented
                    value={reviewTab}
                    onChange={(value) =>
                      setReviewTab(value as "urls" | "selectors" | "preview")
                    }
                    options={[
                      {
                        value: "urls",
                        label: `URLs (${discoveredUrls.length})`,
                      },
                      { value: "selectors", label: "Selectors" },
                      {
                        value: "preview",
                        label:
                          parsePages.length > 0
                            ? `Preview (${parsePages.length})`
                            : "Preview",
                      },
                    ]}
                  />
                </div>
              }
              headerAside={
                <div className="flex shrink-0 items-center gap-1.5">
                  {isAdmin ? (
                    <KnowledgeSetScopeToggle
                      value={sourceScope}
                      onChange={handleScopeChange}
                      disabled={toolbarLocked}
                      size="compact"
                      className="shrink-0 border-border/80 bg-card-solid/80"
                    />
                  ) : null}
                  {sourceScope === "personal" && hostingCaps.localAvailable ? (
                    <SourceHostingToggle
                      value={sourceHosting}
                      onChange={setSourceHosting}
                      disabled={toolbarLocked}
                      size="compact"
                      className="shrink-0 border-border/80 bg-card-solid/80"
                    />
                  ) : null}
                  <button
                    type="button"
                    onClick={handleContinueToExtraction}
                    disabled={Boolean(busy) || selectedPreviewUrls.length === 0}
                    className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-border bg-card-solid px-2.5 font-mono text-[0.5rem] font-semibold tracking-[0.08em] text-muted uppercase transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {busy === "parse" ? (
                      <>
                        <Spinner className="size-3" />
                        Previewing…
                      </>
                    ) : (
                      "Preview"
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={handleIndexAndSave}
                    disabled={
                      Boolean(busy) ||
                      (selectedPreviewUrls.length === 0 && parsePages.length === 0)
                    }
                    className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-foreground/15 bg-foreground px-2.5 font-mono text-[0.5rem] font-semibold tracking-[0.08em] text-background uppercase transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {busy === "save" ? (
                      <>
                        <Spinner className="size-3" />
                        Indexing…
                      </>
                    ) : saved ? (
                      "Indexed ✓"
                    ) : (
                      "Index & save"
                    )}
                  </button>
                  {busy === "save" ? (
                    <button
                      type="button"
                      onClick={abortIndex}
                      className="inline-flex h-7 shrink-0 items-center rounded-md border border-border bg-card-solid px-2.5 font-mono text-[0.5rem] font-semibold tracking-[0.08em] text-muted uppercase transition-colors hover:text-foreground"
                    >
                      Stop
                    </button>
                  ) : null}
                </div>
              }
              footer={
                reviewTab === "urls" ? (
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-2.5 sm:px-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[0.5625rem] text-muted">
                      {canonicalAliasCount > 0
                        ? `${totalUrlsSeen} discovered · ${discoveredUrls.length} unique · ${canonicalAliasCount} aliases merged`
                        : `${discoveredUrls.length} discovered`}
                      {selectedPreviewUrls.length > 0
                        ? ` · ${selectedPreviewUrls.length} selected`
                        : ""}
                      {otherSkippedCount > 0
                        ? ` · ${otherSkippedCount} skipped`
                        : ""}
                    </span>
                    {discoveredUrls.length > 0 ? (
                      <>
                        <button
                          type="button"
                          onClick={selectAllPreviewUrls}
                          className="rounded-md border border-border bg-surface-raised px-2 py-0.5 font-mono text-[0.5rem] font-semibold tracking-[0.08em] text-muted uppercase transition-colors hover:text-foreground"
                        >
                          Select all
                        </button>
                        <button
                          type="button"
                          onClick={clearPreviewSelection}
                          disabled={selectedPreviewUrls.length === 0}
                          className="rounded-md border border-border bg-surface-raised px-2 py-0.5 font-mono text-[0.5rem] font-semibold tracking-[0.08em] text-muted uppercase transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          Clear
                        </button>
                      </>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {indexEstimate ? (
                      <span className="font-mono text-[0.5625rem] text-muted">
                        ~
                        {(
                          indexEstimate.extrapolatedTotalChunks ??
                          indexEstimate.totalEstimatedChunks
                        ).toLocaleString()}{" "}
                        chunks
                      </span>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => void handleEstimateIndexSize()}
                      disabled={
                        estimatingIndex ||
                        Boolean(busy) ||
                        selectedPreviewUrls.length === 0
                      }
                      className="inline-flex items-center rounded-md border border-border bg-surface-raised px-2 py-0.5 font-mono text-[0.5rem] font-semibold tracking-[0.1em] text-muted uppercase transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {estimatingIndex ? "Estimating…" : "Estimate size"}
                    </button>
                    <button
                      type="button"
                      onClick={copySelectedUrls}
                      disabled={selectedPreviewUrls.length === 0}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 font-mono text-[0.5rem] font-semibold tracking-[0.1em] uppercase transition-colors",
                        selectedPreviewUrls.length === 0
                          ? "cursor-not-allowed border-border text-muted/50"
                          : copiedSelection
                            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                            : "border-border bg-surface-raised text-muted hover:text-foreground",
                      )}
                      title="Copy selected URLs"
                    >
                      {copiedSelection ? "Copied" : "Copy"}
                    </button>
                  </div>
                </div>
                ) : undefined
              }
            >
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              {reviewTab === "urls" ? (
                <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              {urlPathBreakdown.length > 1 ? (
                <div className="mb-3 flex flex-wrap gap-1.5">
                  {urlPathBreakdown.map((group) => {
                    const segmentState = getPathSegmentSelectionState(
                      discoveredUrls,
                      group.segment,
                      selectedPreviewUrls,
                    );
                    return (
                    <button
                      key={group.segment}
                      type="button"
                      aria-pressed={segmentState !== "none"}
                      onClick={(event) => selectUrlsForPathSegment(group.segment, event)}
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[0.5625rem] font-semibold tracking-[0.06em] uppercase transition-colors",
                        segmentState === "all"
                          ? "border-foreground/20 bg-foreground text-background"
                          : segmentState === "partial"
                            ? "border-accent/40 bg-accent/10 text-accent"
                            : "border-border bg-surface-raised text-muted hover:border-foreground/15 hover:text-foreground",
                      )}
                      title={group.sampleUrls.join("\n")}
                    >
                      /{group.segment}
                      <span
                        className={
                          segmentState === "all" ? "opacity-80" : "text-foreground"
                        }
                      >
                        {group.count}
                      </span>
                    </button>
                    );
                  })}
                </div>
              ) : null}

              <ul className="min-h-0 flex-1 divide-y divide-border overflow-y-auto rounded-xl border border-border bg-background">
                {discoveredUrls.length === 0 ? (
                  <li className="px-4 py-6 text-center text-[0.6875rem] leading-5 text-muted">
                    {enableSitemap ? (
                      <>
                        No pages found. Loosen your patterns and re-run the
                        crawl.
                      </>
                    ) : (
                      <>
                        No pages found. Enable sitemap discovery or add a start
                        URL with HTML links on the same domain.
                      </>
                    )}
                  </li>
                ) : (
                  discoveredUrls.map((item, index) => {
                    const selected = selectedPreviewUrls.includes(item.url);
                    const pathTag = showUrlPathTags
                      ? config.startUrls.length > 1
                        ? sourcePathLabelForUrl(item.url, config.startUrls) ??
                          pathSegmentLabelForUrl(item.url)
                        : pathSegmentLabelForUrl(item.url)
                      : null;
                    return (
                      <li key={item.url}>
                        <button
                          type="button"
                          role="checkbox"
                          aria-checked={selected}
                          aria-label={`${selected ? "Deselect" : "Select"} ${item.url}`}
                          onClick={(event) =>
                            handlePreviewUrlClick(index, item.url, event)
                          }
                          className={cn(
                            "flex w-full items-center gap-3 px-3 py-2 text-left transition-colors sm:px-4",
                            selected
                              ? "bg-accent-soft"
                              : "hover:bg-surface-raised",
                          )}
                        >
                          <span
                            aria-hidden
                            className="w-6 shrink-0 text-right font-mono text-[0.5625rem] tabular-nums text-muted"
                          >
                            {index + 1}
                          </span>
                          <span
                            aria-hidden
                            className={cn(
                              "flex size-4 shrink-0 items-center justify-center rounded-[4px] border-2 transition-colors",
                              selected
                                ? "border-accent bg-accent text-background"
                                : "border-muted-strong bg-card-solid text-transparent",
                            )}
                          >
                            {selected ? (
                              <svg
                                viewBox="0 0 10 8"
                                className="size-2.5 fill-none stroke-current stroke-[2.5]"
                              >
                                <path d="M1 4l2.5 2.5L9 1" />
                              </svg>
                            ) : null}
                          </span>
                          {pathTag ? (
                            <span
                              className="w-[4.75rem] shrink-0 truncate rounded border border-border bg-surface-raised px-1.5 py-0.5 text-center font-mono text-[0.5rem] font-semibold tracking-[0.06em] text-muted uppercase"
                              title={pathTag}
                            >
                              {pathTag}
                            </span>
                          ) : null}
                          <span className="min-w-0 flex-1 truncate font-mono text-[0.6875rem] text-muted-strong">
                            {item.title ? (
                              <>
                                <span className="text-foreground">{item.title}</span>
                                <span className="text-muted"> · {item.url}</span>
                              </>
                            ) : (
                              item.url
                            )}
                          </span>
                        </button>
                      </li>
                    );
                  })
                )}
              </ul>

              {skippedUrls.length > 0 ? (
                <details className="group mt-3" open={discoveredUrls.length === 0}>
                  <summary className="flex cursor-pointer list-none items-center gap-2 text-[0.6875rem] text-muted transition-colors hover:text-foreground [&::-webkit-details-marker]:hidden">
                    <span
                      aria-hidden
                      className="inline-block transition-transform group-open:rotate-90"
                    >
                      ▸
                    </span>
                    {skippedUrls.length} URLs skipped
                    {canonicalAliasCount > 0
                      ? ` (${canonicalAliasCount} canonical aliases)`
                      : ""}
                  </summary>
                  <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto rounded-xl border border-border bg-background p-2">
                    {skippedUrls.slice(0, 100).map((item, index) => (
                      <li
                        key={`${index}-${item.url}-${item.reason}`}
                        className="flex items-baseline gap-2 text-[0.6875rem]"
                      >
                        <span className="shrink-0 rounded-md border border-border bg-surface-raised px-1.5 py-0.5 font-mono text-[0.5rem] text-muted uppercase">
                          {item.reason}
                        </span>
                        <span className="truncate font-mono text-muted">
                          {item.url}
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
                </div>
              ) : null}

              {reviewTab === "selectors" ? (
                <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <p className="mb-3 shrink-0 text-[0.6875rem] leading-5 text-muted">
                Tune selectors, then preview up to {PARSE_PREVIEW_URL_LIMIT}{" "}
                random pages from your selection. Nothing is saved until you
                click Index &amp; save.
              </p>
              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto">
                <div className="space-y-1.5">
                  <label className="font-mono text-[0.5625rem] font-semibold tracking-[0.12em] text-muted uppercase">
                    Content selectors
                  </label>
                  <textarea
                    value={contentSelectorsText}
                    onChange={(e) => setContentSelectorsText(e.target.value)}
                    rows={4}
                    spellCheck={false}
                    className="field-input font-mono text-xs leading-5"
                    placeholder="article, main, .content"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="font-mono text-[0.5625rem] font-semibold tracking-[0.12em] text-muted uppercase">
                    Exclude selectors
                  </label>
                  <textarea
                    value={excludeSelectorsText}
                    onChange={(e) => setExcludeSelectorsText(e.target.value)}
                    rows={4}
                    spellCheck={false}
                    className="field-input font-mono text-xs leading-5"
                    placeholder="nav, footer, .sidebar, .toc"
                  />
                </div>
              </div>
                </div>
              ) : null}

              {reviewTab === "preview" ? (
                parsePages.length > 0 ? (
                  <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                    {parsePages[activePreviewTab] ? (
                      <PreviewPane page={parsePages[activePreviewTab]} />
                    ) : null}
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-border bg-background px-4 py-10 text-center">
                    <p className="text-sm text-muted">
                      No preview yet. Select URLs, tune selectors if needed,
                      then click{" "}
                      <span className="font-medium text-foreground">Preview</span>
                      .
                    </p>
                  </div>
                )
              ) : null}
              </div>
            </WidgetPanel>
          </div>
        )}
      </div>

      {step === 2 && discoveredUrls.length > 0 ? (
        <CrawlUrlFilterAssistant
          urls={discoveredUrls}
          selectedUrls={selectedPreviewUrls}
          onSelectionChange={setSelectedPreviewUrls}
          disabled={Boolean(busy)}
        />
      ) : null}

      <div className="shrink-0 border-t border-border/60 bg-card-solid px-3 py-2 sm:px-6">
        <div className="mx-auto w-full min-w-0 max-w-[90rem] overflow-hidden rounded-xl border border-border bg-surface-raised/80 shadow-card">
          <IngestPipelineFlow
            pipeline={displayPipeline}
            layout="horizontal"
            variant="banner"
            bannerSize="strip"
            className="border-0 bg-transparent shadow-none"
            animate={pipelineAnimating}
            activeStepId={step === 1 ? "crawl" : "extract"}
            onStepClick={(id) => {
              if (id === "crawl") handleCancelCrawlReview();
              if (id === "extract" && crawlRun) setStep(2);
            }}
            disabledStepIds={crawlRun ? [] : ["extract"]}
          />
        </div>
      </div>

      <SourceVersionResolutionModal
        open={duplicateModalOpen}
        duplicate={pendingDuplicate}
        onCancel={handleVersionResolutionCancel}
        onConfirm={handleVersionResolutionConfirm}
      />
    </div>
  );
}

/* ─── Building blocks ─────────────────────────────────────────── */

const configFieldLabelClass =
  "mb-1.5 block font-mono text-[0.5625rem] font-semibold tracking-[0.1em] text-muted uppercase";

const configPanelShellClass =
  "overflow-hidden rounded-xl border border-border bg-card-solid shadow-card";

const configPanelInsetClass =
  "rounded-xl border border-border bg-surface-raised/60 p-3";

function ToolbarDivider() {
  return (
    <span
      aria-hidden
      className="mx-0.5 hidden h-4 w-px shrink-0 bg-border/70 sm:inline"
    />
  );
}

function formatUrlLabel(url: string) {
  try {
    const parsed = new URL(url);
    const path =
      parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/$/, "");
    return `${parsed.hostname}${path}`;
  } catch {
    return url;
  }
}

function pickRandomSample<T>(items: T[], count: number): T[] {
  if (items.length <= count) return [...items];

  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, count);
}

function sampleUrlsEvenly(urls: string[], max: number): string[] {
  if (urls.length <= max) return urls;
  const step = urls.length / max;
  const sample: string[] = [];
  for (let i = 0; i < max; i += 1) {
    sample.push(urls[Math.floor(i * step)]!);
  }
  return sample;
}

function isValidStartUrl(input: string) {
  const trimmed = input.trim();
  if (!trimmed) return false;

  try {
    const url = new URL(normalizeStartUrl(trimmed));
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function previewHeading(siteName: string, title: string, displayUrl: string) {
  const hostname = displayUrl.split("/")[0] ?? displayUrl;

  if (title) {
    const afterPipe = title.split("|").pop()?.trim();
    if (afterPipe && afterPipe.length > 2 && afterPipe !== siteName) {
      return afterPipe;
    }
  }

  if (
    siteName &&
    siteName.length > 2 &&
    siteName.toLowerCase() !== "overview" &&
    siteName !== hostname
  ) {
    return siteName;
  }

  return hostname;
}

function WidgetCardHeader({
  status,
  label,
  leadingAside,
  centerAside,
  aside,
}: {
  status: "idle" | "loading" | "ready";
  label: string;
  leadingAside?: ReactNode;
  centerAside?: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <div className="relative flex min-w-0 shrink-0 items-center gap-2 border-b border-border bg-surface-raised px-3 py-2 sm:gap-3 sm:px-4">
      <div className="z-10 flex min-w-0 shrink items-center gap-2">
        <span
          className={cn(
            "size-2 shrink-0 rounded-full",
            status === "ready" && "bg-emerald-500",
            status === "loading" && "animate-pulse bg-accent/80",
            status === "idle" && "bg-accent/80",
          )}
        />
        <span className="truncate font-mono text-[0.5625rem] font-semibold tracking-[0.12em] text-muted uppercase">
          {label}
        </span>
      </div>
      {leadingAside ? (
        <div className="z-10 flex shrink-0 items-center">{leadingAside}</div>
      ) : null}
      {centerAside ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-28 sm:px-40">
          <div className="pointer-events-auto flex min-w-0 max-w-full items-center justify-center overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {centerAside}
          </div>
        </div>
      ) : null}
      {aside ? (
        <div className="z-10 ml-auto flex min-w-0 shrink-0 items-center justify-end gap-1.5 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {aside}
        </div>
      ) : null}
    </div>
  );
}

function WidgetPanel({
  headerStatus,
  headerLabel,
  headerLeadingAside,
  headerCenterAside,
  headerAside,
  footer,
  fillHeight = false,
  children,
}: {
  headerStatus: "idle" | "loading" | "ready";
  headerLabel: string;
  headerLeadingAside?: ReactNode;
  headerCenterAside?: ReactNode;
  headerAside?: ReactNode;
  footer?: ReactNode;
  fillHeight?: boolean;
  children: ReactNode;
}) {
  return (
    <section
      className={cn(
        "overflow-hidden rounded-xl border border-border bg-card-solid shadow-card",
        fillHeight && "flex min-h-0 flex-1 flex-col",
      )}
    >
      <WidgetCardHeader
        status={headerStatus}
        label={headerLabel}
        leadingAside={headerLeadingAside}
        centerAside={headerCenterAside}
        aside={headerAside}
      />
      <div
        className={cn(
          "p-3 sm:p-4",
          fillHeight && "flex min-h-0 flex-1 flex-col overflow-hidden",
        )}
      >
        {children}
      </div>
      {footer ? <div className="shrink-0">{footer}</div> : null}
    </section>
  );
}

function StartUrlCardBody({
  primaryStartUrl,
  onPrimaryStartUrlChange,
  additionalStartUrls,
  onAdditionalStartUrlsChange,
  recentStartUrls,
  preflightState,
  preflightError,
  hasUrl,
  urlIsValid,
  isCurrentUrlChecked,
  busy,
  onCheckSite,
  onSubmit,
  handleUrlPaste,
}: {
  primaryStartUrl: string;
  onPrimaryStartUrlChange: (value: string) => void;
  additionalStartUrls: string[];
  onAdditionalStartUrlsChange: (value: string[]) => void;
  recentStartUrls: string[];
  preflightState: "idle" | "loading" | "ok" | "error";
  preflightError: string | null;
  hasUrl: boolean;
  urlIsValid: boolean;
  isCurrentUrlChecked: boolean;
  busy: string | null;
  onCheckSite: (url?: string) => void;
  onSubmit: () => void;
  handleUrlPaste: (event: React.ClipboardEvent<HTMLInputElement>) => void;
}) {
  return (
    <div className="relative space-y-3 p-3 sm:space-y-4 sm:p-4">
      <div className="relative rounded-xl border border-border bg-card-solid">
        <input
          id="primary-start-url"
          type="url"
          value={primaryStartUrl}
          onChange={(e) => onPrimaryStartUrlChange(e.target.value)}
          onPaste={handleUrlPaste}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !busy) onSubmit();
          }}
          spellCheck={false}
          aria-label="Start URL"
          autoFocus
          className={cn(
            "h-10 w-full rounded-xl border-0 bg-transparent px-3.5 font-mono text-[0.8125rem] text-foreground outline-none placeholder:text-muted/80",
            urlIsValid ? "pr-[5.75rem]" : "pr-3.5",
          )}
          placeholder="https://docs.example.com"
        />
        <Button
          type="button"
          variant="secondary"
          onClick={() => onCheckSite()}
          disabled={!urlIsValid || preflightState === "loading"}
          aria-hidden={!urlIsValid}
          tabIndex={urlIsValid ? 0 : -1}
          className={cn(
            "absolute top-1/2 right-1 h-8 -translate-y-1/2 px-3 text-xs sm:text-sm",
            !urlIsValid && "pointer-events-none opacity-0",
          )}
        >
          {preflightState === "loading" ? (
            <Spinner />
          ) : isCurrentUrlChecked ? (
            "Recheck"
          ) : (
            "Check"
          )}
        </Button>
      </div>

      {preflightState === "error" && hasUrl && preflightError ? (
        <div className="space-y-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2">
          <p className="text-[0.6875rem] leading-5 text-amber-800 dark:text-amber-200">
            {preflightError}
          </p>
          {preflightError === UNSUPPORTED_PDF_START_URL_MESSAGE ? (
            <p className="text-[0.625rem] leading-4 text-amber-700/90 dark:text-amber-300/90">
              Detected from the URL path (e.g. ends with .pdf). Extension-less
              PDF downloads are also rejected after Check via Content-Type.
            </p>
          ) : /HTTP 403|HTTP 401/.test(preflightError) ? (
            <p className="text-[0.625rem] leading-4 text-amber-700/90 dark:text-amber-300/90">
              Next: retry Check (browser-style request), or use Render JavaScript
              once browser crawl ships for harder Cloudflare challenges.
            </p>
          ) : null}
        </div>
      ) : null}

      {recentStartUrls.length > 0 ? (
        <div className="space-y-2">
          <p className="font-mono text-[0.5625rem] font-semibold tracking-[0.12em] text-muted uppercase">
            Recent
          </p>
          <div className="flex flex-wrap gap-1.5">
            {recentStartUrls.map((url) => {
              const isActive =
                normalizeStartUrl(primaryStartUrl.trim()) === url;

              return (
                <button
                  key={url}
                  type="button"
                  onClick={() => {
                    onPrimaryStartUrlChange(url);
                    onCheckSite(url);
                  }}
                  title={url}
                  className={cn(
                    "max-w-full truncate rounded-md border px-2 py-0.5 font-mono text-[0.5rem] font-semibold tracking-[0.1em] text-muted uppercase transition-colors sm:max-w-[15rem]",
                    isActive
                      ? "border-foreground/25 bg-surface-raised text-foreground shadow-card"
                      : "border-border bg-surface-raised hover:text-foreground",
                  )}
                >
                  {formatUrlLabel(url)}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {additionalStartUrls.length > 0 ? (
        <div className="space-y-2 border-t border-border pt-3">
          <p className="font-mono text-[0.5625rem] font-semibold tracking-[0.12em] text-muted uppercase">
            Additional start URLs
          </p>
          <div className="flex flex-col gap-2">
            {additionalStartUrls.map((extraUrl, index) => (
              <div key={`extra-start-url-${index}`} className="flex items-center gap-2">
                <input
                  type="url"
                  spellCheck={false}
                  value={extraUrl}
                  onChange={(e) => {
                    const next = [...additionalStartUrls];
                    next[index] = e.target.value;
                    onAdditionalStartUrlsChange(next);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !busy) onSubmit();
                  }}
                  aria-label={`Additional start URL ${index + 1}`}
                  className="field-input min-w-0 flex-1 font-mono text-xs"
                  placeholder="https://docs.example.com/guides"
                />
                <button
                  type="button"
                  aria-label="Remove start URL"
                  className="inline-flex size-9 shrink-0 items-center justify-center rounded-md border border-border text-muted transition-colors hover:bg-surface-raised hover:text-foreground"
                  onClick={() =>
                    onAdditionalStartUrlsChange(
                      additionalStartUrls.filter((_, i) => i !== index),
                    )
                  }
                >
                  <Trash2 className="size-3.5" aria-hidden />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() =>
                onAdditionalStartUrlsChange([...additionalStartUrls, "https://"])
              }
              className="inline-flex w-fit items-center gap-1.5 rounded-md border border-dashed border-border px-2.5 py-1.5 text-[0.6875rem] font-medium text-muted transition-colors hover:border-foreground/30 hover:text-foreground"
            >
              <Plus className="size-3.5" aria-hidden />
              Add start URL
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => onAdditionalStartUrlsChange(["https://"])}
          className="inline-flex w-fit items-center gap-1.5 text-[0.6875rem] text-muted transition-colors hover:text-foreground"
        >
          <Plus className="size-3.5" aria-hidden />
          Add more start URLs
        </button>
      )}
    </div>
  );
}

function StartUrlCard({
  primaryStartUrl,
  onPrimaryStartUrlChange,
  additionalStartUrls,
  onAdditionalStartUrlsChange,
  recentStartUrls,
  preflightState,
  preflightError,
  sourceName,
  preflightTitle,
  preflightOgImage,
  preflightFaviconUrl,
  preflightCheckedUrl,
  discoverySignals,
  sourceMetadata,
  maxPages,
  enableSitemap,
  onCheckSite,
  busy,
  crawlCardPhase,
  pagesDiscovered,
  onSubmit,
  isAdmin = false,
  sourceScope,
  onScopeChange,
  sourceHosting = "local",
  onHostingChange,
  showHostingToggle = false,
  toolbarLocked = false,
  onAbortCrawl,
}: {
  primaryStartUrl: string;
  onPrimaryStartUrlChange: (value: string) => void;
  additionalStartUrls: string[];
  onAdditionalStartUrlsChange: (value: string[]) => void;
  recentStartUrls: string[];
  preflightState: "idle" | "loading" | "ok" | "error";
  preflightError: string | null;
  sourceName: string;
  preflightTitle: string;
  preflightOgImage: string | null;
  preflightFaviconUrl: string | null;
  preflightCheckedUrl: string;
  discoverySignals: DiscoverySignals | null;
  sourceMetadata: SourceMetadata | null;
  maxPages: number;
  enableSitemap: boolean;
  onCheckSite: (url?: string) => void;
  busy: string | null;
  crawlCardPhase: CrawlCardPhase;
  pagesDiscovered: number;
  onSubmit: () => void;
  isAdmin?: boolean;
  sourceScope: KnowledgeSetScope;
  onScopeChange: (scope: KnowledgeSetScope) => void;
  sourceHosting?: SourceHosting;
  onHostingChange?: (hosting: SourceHosting) => void;
  showHostingToggle?: boolean;
  toolbarLocked?: boolean;
  onAbortCrawl?: () => void;
}) {
  const hasUrl = Boolean(primaryStartUrl.trim());
  const normalizedUrl = normalizeStartUrl(primaryStartUrl.trim());
  const urlIsValid = isValidStartUrl(primaryStartUrl);
  const crawlStartUrlCount = buildStartUrls(
    primaryStartUrl,
    additionalStartUrls,
  ).length;
  const isCurrentUrlChecked =
    preflightState === "ok" && normalizedUrl === preflightCheckedUrl;
  const showSitePreview =
    isCurrentUrlChecked && Boolean(sourceName) && hasUrl;
  const isCrawling = crawlCardPhase === "crawling";
  const isCrawlComplete = crawlCardPhase === "complete";
  const showSplitLayout =
    showSitePreview || isCrawling || isCrawlComplete;
  const showCrawlStatusPanel = isCrawling || isCrawlComplete;
  const [mobileSplitTab, setMobileSplitTab] = useState<"setup" | "preview">(
    "setup",
  );

  useEffect(() => {
    if (!showSplitLayout) {
      setMobileSplitTab("setup");
    }
  }, [showSplitLayout]);

  useEffect(() => {
    if (showSitePreview) {
      setMobileSplitTab("preview");
    }
  }, [showSitePreview]);

  function handleUrlPaste(event: React.ClipboardEvent<HTMLInputElement>) {
    const pasted = event.clipboardData.getData("text").trim();
    if (!pasted) return;

    window.setTimeout(() => {
      onCheckSite(normalizeStartUrl(pasted));
    }, 0);
  }

  const displayUrl = formatUrlLabel(normalizeStartUrl(primaryStartUrl.trim()));
  const detectedName = previewHeading(sourceName, preflightTitle, displayUrl);
  const widgetStatus: "idle" | "loading" | "ready" = isCrawling
    ? "loading"
    : isCrawlComplete
      ? "ready"
      : showSitePreview
        ? "ready"
        : preflightState === "loading"
          ? "loading"
          : "idle";
  const widgetLabel = isCrawling
    ? pagesDiscovered > 0
      ? `Ingestion pipeline · Crawling site (${pagesDiscovered} / ${maxPages})`
      : "Ingestion pipeline · Crawling site"
    : isCrawlComplete
      ? `Ingestion pipeline · ${pagesDiscovered} page${pagesDiscovered === 1 ? "" : "s"} found`
      : preflightState === "loading"
        ? "Ingestion pipeline · Checking site"
        : showSitePreview
          ? `Ingestion pipeline · ${detectedName}`
          : "Ingestion pipeline · Web crawl";

  const showDiscoveryFooter =
    preflightState === "loading" || discoverySignals != null;
  const displaySignals = sourceMetadata
    ? getDisplayDetectedSignals(sourceMetadata)
    : [];
  const showMetadataFooter = showSitePreview && sourceMetadata != null;
  const showFooter =
    isCrawling ||
    isCrawlComplete ||
    !showSitePreview ||
    showDiscoveryFooter ||
    showMetadataFooter;

  return (
    <section
      className={cn(
        "relative mx-auto flex w-full min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-card-solid shadow-card transition-[max-width,box-shadow] duration-500 ease-out",
        showSplitLayout
          ? "max-h-[calc(100dvh-6.5rem)] max-w-2xl"
          : "aspect-video max-h-[min(28rem,100%)] max-w-xl",
        isCrawling && "ring-1 ring-accent/25",
        isCrawlComplete && "ring-1 ring-emerald-500/20",
      )}
    >
      <WidgetCardHeader
        status={widgetStatus}
        label={widgetLabel}
        aside={
          <>
            {isAdmin ? (
              <KnowledgeSetScopeToggle
                value={sourceScope}
                onChange={onScopeChange}
                disabled={toolbarLocked}
                size="compact"
                className="shrink-0 border-border/80 bg-card-solid/80"
              />
            ) : null}
            {showHostingToggle && onHostingChange ? (
              <SourceHostingToggle
                value={sourceHosting}
                onChange={onHostingChange}
                disabled={toolbarLocked}
                size="compact"
                className="shrink-0 border-border/80 bg-card-solid/80"
              />
            ) : null}
            {busy === "crawl" ? (
              <button
                type="button"
                onClick={onAbortCrawl}
                className="inline-flex h-7 shrink-0 items-center rounded-md border border-border bg-card-solid px-2.5 font-mono text-[0.5rem] font-semibold tracking-[0.08em] text-muted uppercase transition-colors hover:text-foreground"
              >
                Stop
              </button>
            ) : (
              <button
                type="button"
                onClick={onSubmit}
                disabled={Boolean(busy) || crawlCardPhase !== "idle"}
                className="inline-flex h-7 shrink-0 items-center rounded-md border border-foreground/15 bg-foreground px-2.5 font-mono text-[0.5rem] font-semibold tracking-[0.08em] text-background uppercase transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Crawl{crawlStartUrlCount > 1 ? ` ${crawlStartUrlCount}` : ""}
              </button>
            )}
          </>
        }
      />

      <div
        className={cn(
          "min-h-0 flex-1",
          showSplitLayout
            ? "relative flex flex-col overflow-hidden"
            : "relative overflow-x-hidden overflow-y-auto overscroll-contain",
        )}
      >
        {showSplitLayout ? (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="shrink-0 border-b border-border px-3 py-2 lg:hidden">
              <Segmented
                value={mobileSplitTab}
                onChange={(value) =>
                  setMobileSplitTab(value === "preview" ? "preview" : "setup")
                }
                options={[
                  { value: "setup", label: "URL & scope" },
                  { value: "preview", label: "Preview" },
                ]}
              />
            </div>
            <div
              className={cn(
                "flex min-h-0 flex-1 flex-col overscroll-contain lg:flex-row lg:items-stretch lg:overflow-hidden",
                mobileSplitTab === "setup"
                  ? "overflow-y-auto"
                  : "items-start overflow-hidden",
              )}
            >
            <div
              className={cn(
                "min-w-0 flex-1 border-border lg:border-r",
                mobileSplitTab !== "setup" && "hidden lg:block",
              )}
            >
              <div className="relative min-w-0">
              <div
                className={cn(
                  "transition-all duration-300 ease-out",
                  showCrawlStatusPanel
                    ? "pointer-events-none absolute inset-0 opacity-0"
                    : "opacity-100",
                )}
                aria-hidden={showCrawlStatusPanel}
              >
                <StartUrlCardBody
                  primaryStartUrl={primaryStartUrl}
                  onPrimaryStartUrlChange={onPrimaryStartUrlChange}
                  additionalStartUrls={additionalStartUrls}
                  onAdditionalStartUrlsChange={onAdditionalStartUrlsChange}
                  recentStartUrls={recentStartUrls}
                  preflightState={preflightState}
                  preflightError={preflightError}
                  hasUrl={hasUrl}
                  urlIsValid={urlIsValid}
                  isCurrentUrlChecked={isCurrentUrlChecked}
                  busy={busy}
                  onCheckSite={onCheckSite}
                  onSubmit={onSubmit}
                  handleUrlPaste={handleUrlPaste}
                />
              </div>

              {isCrawling ? (
                <div
                  className="animate-crawl-panel-enter flex min-h-[14rem] flex-col justify-center p-4 sm:p-5"
                  aria-live="polite"
                  aria-busy="true"
                >
                  <CrawlInProgressPanel
                    displayUrl={displayUrl}
                    maxPages={maxPages}
                    pagesDiscovered={pagesDiscovered}
                    enableSitemap={enableSitemap}
                    robotsFound={discoverySignals?.robots.found}
                    sitemapFound={discoverySignals?.sitemap.found}
                  />
                </div>
              ) : null}

              {isCrawlComplete ? (
                <div
                  className="animate-crawl-panel-enter flex min-h-[14rem] flex-col justify-center p-4 sm:p-5"
                  aria-live="polite"
                >
                  <CrawlCompletePanel
                    displayUrl={displayUrl}
                    pagesDiscovered={pagesDiscovered}
                  />
                </div>
              ) : null}
              </div>
            </div>

            <div
              className={cn(
                "w-full shrink-0 self-start lg:w-1/2 lg:min-w-0 lg:self-stretch",
                mobileSplitTab !== "preview" && "hidden lg:block",
              )}
            >
              <PreflightPreviewPanel
                imageUrl={preflightOgImage}
                faviconUrl={preflightFaviconUrl}
                siteName={sourceName}
                title={preflightTitle}
                url={primaryStartUrl}
              />
            </div>
            </div>
          </div>
        ) : showCrawlStatusPanel ? (
          <div
            className="animate-crawl-panel-enter p-4 sm:p-5"
            aria-live="polite"
            aria-busy={isCrawling}
          >
            {isCrawling ? (
              <CrawlInProgressPanel
                displayUrl={displayUrl}
                maxPages={maxPages}
                pagesDiscovered={pagesDiscovered}
                enableSitemap={enableSitemap}
                robotsFound={discoverySignals?.robots.found}
                sitemapFound={discoverySignals?.sitemap.found}
              />
            ) : (
              <CrawlCompletePanel
                displayUrl={displayUrl}
                pagesDiscovered={pagesDiscovered}
              />
            )}
          </div>
        ) : (
          <StartUrlCardBody
            primaryStartUrl={primaryStartUrl}
            onPrimaryStartUrlChange={onPrimaryStartUrlChange}
            additionalStartUrls={additionalStartUrls}
            onAdditionalStartUrlsChange={onAdditionalStartUrlsChange}
            recentStartUrls={recentStartUrls}
            preflightState={preflightState}
            preflightError={preflightError}
            hasUrl={hasUrl}
            urlIsValid={urlIsValid}
            isCurrentUrlChecked={isCurrentUrlChecked}
            busy={busy}
            onCheckSite={onCheckSite}
            onSubmit={onSubmit}
            handleUrlPaste={handleUrlPaste}
          />
        )}
      </div>

      {showFooter ? (
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-2 gap-y-1 border-t border-border px-3 py-1.5 sm:gap-x-3 sm:py-2 sm:px-4">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        {isCrawlComplete ? (
          <span className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 font-mono text-[0.5rem] font-semibold tracking-[0.08em] text-emerald-600 uppercase dark:text-emerald-400">
            Opening results…
          </span>
        ) : !showSitePreview && !isCrawling ? (
          <>
            <span className="rounded-md border border-border bg-surface-raised px-2 py-0.5 font-mono text-[0.5rem] text-muted uppercase">
              Paste to check
            </span>
            <span className="rounded-md border border-border bg-surface-raised px-2 py-0.5 font-mono text-[0.5rem] text-muted uppercase">
              Enter runs crawl
            </span>
          </>
        ) : null}
        {showDiscoveryFooter ? (
          <>
            {!showSitePreview && !isCrawling && !isCrawlComplete ? (
              <span className="mx-0.5 hidden h-3 w-px bg-border sm:inline" aria-hidden />
            ) : null}
            <DiscoverySignalPill
              label="Robots"
              found={discoverySignals?.robots.found ?? null}
              loading={preflightState === "loading"}
              title={
                discoverySignals?.robots.found
                  ? `${discoverySignals.robots.url}${discoverySignals.robots.disallowRules != null ? ` · ${discoverySignals.robots.disallowRules} disallow rule(s)` : ""}`
                  : discoverySignals
                    ? `${discoverySignals.robots.url} not found`
                    : "Checking robots.txt…"
              }
            />
            <DiscoverySignalPill
              label={
                discoverySignals?.sitemap.found &&
                discoverySignals.sitemap.pageCount != null
                  ? `Sitemap · ${discoverySignals.sitemap.pageCount}`
                  : "Sitemap"
              }
              found={discoverySignals?.sitemap.found ?? null}
              loading={preflightState === "loading"}
              title={
                discoverySignals?.sitemap.found
                  ? `${discoverySignals.sitemap.url}${discoverySignals.sitemap.pageCount != null ? ` · ${discoverySignals.sitemap.pageCount} pages in scope` : ""}`
                  : discoverySignals
                    ? "No sitemap.xml discovered at common paths"
                    : "Checking sitemap…"
              }
            />
          </>
        ) : null}
        </div>
        {showMetadataFooter && sourceMetadata ? (
          <div className="flex min-w-0 flex-wrap items-center justify-end gap-1">
            <FooterInsightChip
              label={SOURCE_CONTENT_TYPE_LABELS[sourceMetadata.sourceType]}
              title={`${Math.round(sourceMetadata.sourceTypeConfidence * 100)}% match`}
              emphasized
            />
            {displaySignals.map((signal) => (
              <FooterInsightChip
                key={signal}
                label={formatDetectedSignal(signal)}
                title={signal}
              />
            ))}
          </div>
        ) : null}
      </div>
      ) : null}
    </section>
  );
}

function CrawlInProgressPanel({
  displayUrl,
  maxPages,
  pagesDiscovered,
  enableSitemap,
  robotsFound,
  sitemapFound,
}: {
  displayUrl: string;
  maxPages: number;
  pagesDiscovered: number;
  enableSitemap: boolean;
  robotsFound?: boolean;
  sitemapFound?: boolean;
}) {
  const steps = [
    pagesDiscovered > 0
      ? `${pagesDiscovered} / ${maxPages} pages discovered on ${displayUrl}`
      : `Discovering pages on ${displayUrl}`,
    `Up to ${maxPages} pages`,
    enableSitemap
      ? sitemapFound
        ? "Sitemap + links"
        : "HTML links (no sitemap)"
      : "HTML links only",
    robotsFound ? "Respecting robots.txt" : "No robots.txt",
  ];

  return (
    <div className="w-full text-left">
      <div className="flex items-center gap-3">
        <span className="relative flex size-9 shrink-0 items-center justify-center rounded-full border border-accent/25 bg-accent/10">
          <Spinner className="size-4 text-accent" />
        </span>
        <div className="min-w-0">
          <p className="font-mono text-[0.5625rem] font-semibold tracking-[0.12em] text-accent uppercase">
            Crawl in progress
          </p>
          <p className="mt-0.5 text-[0.6875rem] leading-5 text-muted">
            {pagesDiscovered > 0
              ? `${pagesDiscovered} / ${maxPages} pages discovered…`
              : "Finding pages to index…"}
          </p>
        </div>
      </div>

      <ul className="mt-4 space-y-1.5 border-t border-border/60 pt-3">
        {steps.map((step) => (
          <li
            key={step}
            className="flex items-center gap-2 font-mono text-[0.5625rem] leading-5 text-muted-strong"
          >
            <span
              aria-hidden
              className="size-1 shrink-0 animate-pulse rounded-full bg-accent"
            />
            <span className="truncate">{step}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CrawlCompletePanel({
  displayUrl,
  pagesDiscovered,
}: {
  displayUrl: string;
  pagesDiscovered: number;
}) {
  return (
    <div className="w-full text-left">
      <div className="flex items-center gap-3">
        <span className="animate-crawl-complete-pop relative flex size-9 shrink-0 items-center justify-center rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
          <CheckIcon className="size-4" />
        </span>
        <div className="min-w-0 animate-crawl-panel-enter">
          <p className="font-mono text-[0.5625rem] font-semibold tracking-[0.12em] text-emerald-600 uppercase dark:text-emerald-400">
            Crawl complete
          </p>
          <p className="mt-0.5 text-[0.6875rem] leading-5 text-muted">
            {pagesDiscovered > 0
              ? `${pagesDiscovered} page${pagesDiscovered === 1 ? "" : "s"} discovered on ${displayUrl}`
              : `No pages found on ${displayUrl}`}
          </p>
        </div>
      </div>
    </div>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function PreflightPreviewPanel({
  imageUrl,
  faviconUrl,
  siteName,
  title,
  url,
}: {
  imageUrl: string | null;
  faviconUrl: string | null;
  siteName: string;
  title: string;
  url: string;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const [faviconFailed, setFaviconFailed] = useState(false);
  const showOgImage = Boolean(imageUrl) && !imageFailed;
  const showFavicon = Boolean(faviconUrl) && !faviconFailed;
  const displayUrl = formatUrlLabel(normalizeStartUrl(url.trim()));
  const heading = previewHeading(siteName, title, displayUrl);

  return (
    <div className="relative flex w-full min-w-0 flex-col">
      <div className="aspect-video w-full max-h-40 shrink-0 overflow-hidden bg-surface-raised sm:max-h-44 lg:max-h-none">
        {showOgImage ? (
          <img
            src={imageUrl!}
            alt=""
            className="size-full object-contain object-center lg:object-cover"
            referrerPolicy="no-referrer"
            onError={() => setImageFailed(true)}
          />
        ) : (
          <div className="flex size-full items-center justify-center bg-surface-raised">
            <span className="font-mono text-3xl font-semibold uppercase tracking-tight text-foreground/50">
              {heading.slice(0, 2)}
            </span>
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2 border-t border-border px-3 py-1.5 sm:px-4 sm:py-2">
        <div className="min-w-0 flex-1">
          <p
            className="truncate font-mono text-[0.5625rem] leading-4 tracking-wide text-accent uppercase"
            title={title || siteName}
          >
            Source · {heading}
          </p>
          <p className="truncate font-mono text-[0.5625rem] leading-4 text-muted uppercase">
            {displayUrl}
          </p>
        </div>
        {showFavicon ? (
          <img
            src={faviconUrl!}
            alt=""
            className="size-7 shrink-0 rounded-md border border-border bg-background object-contain p-0.5 shadow-card"
            referrerPolicy="no-referrer"
            onError={() => setFaviconFailed(true)}
          />
        ) : null}
      </div>
    </div>
  );
}

function ScopeIcon() {
  return (
    <svg viewBox="0 0 20 20" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <circle cx="10" cy="10" r="5.5" />
      <path d="M10 1.5v2.5M10 16v2.5M1.5 10h2.5M16 10h2.5" strokeLinecap="round" />
    </svg>
  );
}

function DiscoveryIcon() {
  return (
    <svg viewBox="0 0 20 20" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <path d="M4 5.5h12M4 10h8M4 14.5h10" strokeLinecap="round" />
      <circle cx="15.5" cy="10" r="1.25" fill="currentColor" stroke="none" />
    </svg>
  );
}

function RenderingIcon() {
  return (
    <svg viewBox="0 0 20 20" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <path d="M3.5 5.5h13v9h-13z" strokeLinejoin="round" />
      <path d="M7.5 14.5v2M12.5 14.5v2" strokeLinecap="round" />
    </svg>
  );
}

function FooterInsightChip({
  label,
  title,
  emphasized = false,
}: {
  label: string;
  title?: string;
  emphasized?: boolean;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex shrink-0 items-center rounded border px-1.5 py-px font-mono text-[0.4375rem] font-medium tracking-[0.06em] uppercase",
        emphasized
          ? "border-accent/25 bg-accent/10 text-accent"
          : "border-border/80 bg-card-solid/80 text-muted",
      )}
    >
      {label}
    </span>
  );
}

function DiscoverySignalPill({
  label,
  found,
  loading,
  title,
}: {
  label: string;
  found: boolean | null;
  loading?: boolean;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-0.5 font-mono text-[0.5rem] font-semibold tracking-[0.08em] uppercase transition-colors",
        loading && "border-border bg-surface-raised text-muted",
        !loading && found === true &&
          "border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
        !loading && found === false &&
          "border-border bg-surface-raised text-muted/45",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          loading && "animate-pulse bg-muted",
          !loading && found === true && "bg-emerald-500",
          !loading && found === false && "bg-muted/35",
        )}
      />
      {label}
    </span>
  );
}

function ConfigPill({
  label,
  summary,
  compactSummary,
  description,
  icon,
  children,
  disabled = false,
}: {
  label: string;
  summary: ReactNode;
  compactSummary?: ReactNode;
  description?: string;
  icon?: ReactNode;
  children: ReactNode;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [panelRect, setPanelRect] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const syncPanelRect = useCallback(() => {
    const button = buttonRef.current;
    if (!button) return;

    const rect = button.getBoundingClientRect();
    const width = Math.min(304, window.innerWidth - 24);
    const left = Math.min(
      Math.max(12, rect.left),
      window.innerWidth - width - 12,
    );

    setPanelRect({
      top: rect.bottom + 8,
      left,
      width,
    });
  }, []);

  useEffect(() => {
    if (!open) return;

    syncPanelRect();

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        !rootRef.current?.contains(target) &&
        !panelRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    window.addEventListener("resize", syncPanelRect);
    window.addEventListener("scroll", syncPanelRect, true);
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("resize", syncPanelRect);
      window.removeEventListener("scroll", syncPanelRect, true);
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, syncPanelRect]);

  useEffect(() => {
    if (disabled && open) {
      setOpen(false);
    }
  }, [disabled, open]);

  const panel =
    open && panelRect
      ? createPortal(
          <div
            ref={panelRef}
            role="dialog"
            aria-label={label}
            style={{
              position: "fixed",
              top: panelRect.top,
              left: panelRect.left,
              width: panelRect.width,
              zIndex: 200,
            }}
            className={cn(
              "animate-crawl-panel-enter",
              configPanelShellClass,
            )}
          >
            <div className="flex items-start gap-2.5 border-b border-border bg-surface-raised px-3 py-2.5 sm:px-4">
              {icon ? (
                <span
                  className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-card-solid text-muted"
                  aria-hidden
                >
                  {icon}
                </span>
              ) : (
                <span className="mt-1.5 size-2 shrink-0 rounded-full bg-accent/80" />
              )}
              <div className="min-w-0 flex-1">
                <p className="font-mono text-[0.5625rem] font-semibold tracking-[0.12em] text-muted uppercase">
                  {label}
                </p>
                {description ? (
                  <p className="mt-1 text-[0.6875rem] leading-snug text-muted">
                    {description}
                  </p>
                ) : null}
              </div>
            </div>
            <div className="p-3 sm:p-4">{children}</div>
          </div>,
          document.body,
        )
      : null;

  return (
    <div ref={rootRef} className={cn("relative shrink-0", open && "z-[60]")}>
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        onClick={() => {
          if (disabled) return;
          if (open) {
            setOpen(false);
            return;
          }
          syncPanelRect();
          setOpen(true);
        }}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-disabled={disabled || undefined}
        aria-label={`${label} settings`}
        title={typeof summary === "string" ? summary : label}
        className={cn(
          "inline-flex max-w-full shrink-0 items-center gap-1 rounded-lg border border-transparent px-2 py-1.5 text-left transition-[background,border-color,box-shadow,color] sm:gap-1.5 sm:px-2.5",
          disabled && "pointer-events-none cursor-not-allowed opacity-50",
          open
            ? "border-border bg-card-solid text-foreground shadow-card"
            : "text-muted-strong hover:border-border/60 hover:bg-card-solid/80 hover:text-foreground",
        )}
      >
        {icon ? (
          <span className="shrink-0 text-muted/80 sm:hidden" aria-hidden>
            {icon}
          </span>
        ) : null}
        <span className="hidden shrink-0 text-[0.6875rem] font-medium text-muted sm:inline">
          {label}
        </span>
        <span className="hidden min-w-0 max-w-[9rem] truncate text-[0.6875rem] font-medium text-foreground sm:inline">
          {summary}
        </span>
        <span className="min-w-0 max-w-[4.5rem] truncate text-[0.6875rem] font-medium text-foreground sm:hidden">
          {compactSummary ?? summary}
        </span>
        <ChevronDownIcon
          className={cn(
            "size-3 shrink-0 text-muted/70 transition-transform duration-200",
            open && "rotate-180 text-foreground/70",
          )}
        />
      </button>
      {panel}
    </div>
  );
}

function ChevronDownIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 10 6"
      aria-hidden
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M1 1l4 4 4-4" />
    </svg>
  );
}

function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors",
        checked
          ? "border-transparent bg-foreground"
          : "border-border bg-surface-raised",
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "absolute size-4.5 rounded-full shadow-sm transition-[left]",
          checked ? "left-[calc(100%-1.25rem)] bg-background" : "left-0.5 bg-card-solid border border-border",
        )}
      />
    </button>
  );
}

function Segmented({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="inline-flex rounded-lg border border-border bg-surface-raised/80 p-0.5 shadow-card">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          aria-pressed={value === option.value}
          className={cn(
            "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
            value === option.value
              ? "bg-card-solid text-foreground shadow-card"
              : "text-muted hover:text-foreground",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function PreviewSampleBadges({
  pages,
  activeIndex,
  onSelect,
}: {
  pages: ParsePreviewPage[];
  activeIndex: number;
  onSelect: (index: number) => void;
}) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
      {pages.map((page, index) => (
        <button
          key={page.url}
          type="button"
          title={page.title || page.url}
          onClick={() => onSelect(index)}
          className={cn(
            "min-w-0 flex-1 truncate rounded-md border px-2 py-1 font-mono text-[0.5625rem] font-semibold tracking-[0.06em] uppercase transition-colors sm:text-[0.625rem]",
            activeIndex === index
              ? "border-foreground/30 bg-card-solid text-foreground shadow-card"
              : "border-border bg-card-solid/60 text-muted hover:text-foreground",
          )}
        >
          {page.title || page.url}
        </button>
      ))}
    </div>
  );
}

function PreviewPane({ page }: { page: ParsePreviewPage }) {
  const [copiedMarkdown, setCopiedMarkdown] = useState(false);
  const wordCount = page.markdown
    ? page.markdown.split(/\s+/).filter(Boolean).length
    : 0;

  async function copyMarkdown() {
    if (!page.markdown) return;
    try {
      await navigator.clipboard.writeText(page.markdown);
      setCopiedMarkdown(true);
      window.setTimeout(() => setCopiedMarkdown(false), 2000);
    } catch {
      // ignore — clipboard may be blocked
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border bg-surface-raised px-4 py-2">
        <span className="min-w-0 truncate font-mono text-[0.6875rem] text-muted">
          {page.url}
        </span>
        {!page.error ? (
          <div className="flex shrink-0 items-center gap-2">
            <span className="font-mono text-[0.625rem] text-muted">
              {wordCount.toLocaleString()} words
              {page.estimatedChunks != null
                ? ` · ~${page.estimatedChunks} chunks`
                : ""}
            </span>
            <button
              type="button"
              onClick={() => void copyMarkdown()}
              disabled={!page.markdown}
              className={cn(
                "inline-flex items-center rounded-md border px-2 py-0.5 font-mono text-[0.5rem] font-semibold tracking-[0.1em] uppercase transition-colors",
                !page.markdown
                  ? "cursor-not-allowed border-border text-muted/50"
                  : copiedMarkdown
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                    : "border-border bg-card-solid text-muted hover:text-foreground",
              )}
              title="Copy markdown"
            >
              {copiedMarkdown ? "Copied" : "Copy"}
            </button>
          </div>
        ) : null}
      </div>
      {page.error ? (
        <p className="bg-card-solid px-4 py-5 text-sm text-red-600 dark:text-red-400">
          {page.error}
        </p>
      ) : (
        <pre className="min-h-0 flex-1 overflow-auto bg-card-solid px-4 py-3 font-mono text-xs leading-5 whitespace-pre-wrap text-muted-strong">
          {page.markdown || "(empty content — try broader selectors)"}
        </pre>
      )}
    </div>
  );
}

function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent",
        className ?? "mr-2",
      )}
    />
  );
}
