"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type MouseEvent as ReactMouseEvent } from "react";
import { createPortal } from "react-dom";
import { useRouter, useSearchParams } from "next/navigation";
import { Copy, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { IngestPipelineFlow } from "@/components/sources/ingest-pipeline-flow";
import { CrawlUrlFilterAssistant } from "@/components/sources/crawl-url-filter-assistant";
import { NewSourceFirstHint } from "@/components/sources/new-source-first-hint";
import { AgentGuideReviewDialog } from "@/components/sources/agent-guide-review-dialog";
import { MobileMenuButton } from "@/components/app/app-shell";
import { setWebCrawlHeaderControls } from "@/contexts/web-crawl-header-context";
import { getLedgeIndexDesktop } from "@/lib/ledgeindex-desktop";
import {
  KnowledgeSetScopeToggle,
  type KnowledgeSetScope,
} from "@/components/sources/knowledge-set-scope-toggle";
import { SourceHostingToggle } from "@/components/sources/source-hosting-toggle";
import { IndexLocationInfo } from "@/components/sources/index-location-info";
import { useAuth } from "@/lib/auth-context";
import { usePlanBilling } from "@/contexts/plan-billing-context";
import {
  canManageStagehandRuntimeOnApi,
  resolveHeaderNavDiscoveryApiBase,
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
import {
  partitionSkippedUrls,
  isHttpStatusSkipReason,
  promoteHttpErrorsIntoReviewList,
  type DiscoveredReviewUrl,
} from "@/lib/canonical-dedupe";
import {
  SourceVersionResolutionModal,
  type VersionResolutionChoice,
} from "@/components/sources/source-version-resolution-modal";
import { SitemapSelectModal } from "@/components/sources/sitemap-select-modal";
import { RobotsTxtModal } from "@/components/sources/robots-txt-modal";
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
  discoverHeaderNavPaths,
  getStagehandRuntimeStatus,
  installStagehandRuntime,
  resumeIngestWorkflow,
  runParsePreview,
  startIngestWorkflow,
  updateSource,
  proposeCrawlFilterRemovals,
  UNSUPPORTED_PDF_START_URL_MESSAGE,
  isPdfUrl,
  type CrawlRun,
  type DiscoverySignals,
  type HeaderNavPath,
  type HeaderNavBrowserRuntime,
  type IngestPipelineSnapshot,
  type IndexSizeEstimate,
  type ParsePreviewPage,
  type SourceDuplicateMatch,
  type StagehandRuntimeStatus,
  type WebCrawlConfig,
} from "@/lib/ledgeindex-api";
import {
  collectUrlsForPathSegments,
  filterUrlsByPathSegment,
  getPathSegmentSelectionState,
  groupDiscoveredUrlsByPath,
} from "@/lib/crawl-url-breakdown";
import {
  discoverExcludePatternsFromUrls,
  filterUrlsByExcludePatterns,
  mergeExcludePatterns,
} from "@/lib/discover-exclude-patterns";
import {
  pathSegmentLabelForUrl,
  sourcePathLabelForUrl,
} from "@/lib/source-paths";
import { readCrawlProvider, crawlModelIdForProvider } from "@/lib/crawl-provider";

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

function sameStartUrlForBranding(left: string, right: string): boolean {
  if (!left || !right) return false;
  if (left === right) return true;
  try {
    const normalize = (raw: string) => {
      const url = new URL(raw);
      url.hash = "";
      url.search = "";
      url.pathname = url.pathname.replace(/\/+$/, "") || "/";
      return url.href;
    };
    return normalize(left) === normalize(right);
  } catch {
    return false;
  }
}

function urlMatchesPattern(
  url: string,
  pattern: string,
  patternsAreRegex: boolean,
): boolean {
  if (patternsAreRegex) {
    try {
      return new RegExp(pattern).test(url);
    } catch {
      return false;
    }
  }
  return url.includes(pattern);
}

function urlMatchesAnyPattern(
  url: string,
  patterns: string[],
  patternsAreRegex: boolean,
): boolean {
  return patterns.some((pattern) =>
    urlMatchesPattern(url, pattern, patternsAreRegex),
  );
}

function excludePatternForPathSegment(segment: string): string {
  return `/${segment}/`;
}

function parseUrlPathParts(url: string): {
  origin: string;
  segments: string[];
} | null {
  try {
    const parsed = new URL(url);
    return {
      origin: parsed.origin,
      segments: parsed.pathname.split("/").filter(Boolean),
    };
  } catch {
    return null;
  }
}

function excludePatternFromPathPrefix(segments: string[], endIndex: number): string {
  const prefix = segments.slice(0, endIndex + 1);
  if (prefix.length === 0) return "/";
  return `/${prefix.join("/")}/`;
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
  const { showPlanLimit } = usePlanBilling();
  const hostingCaps = useHostingCapabilities();
  const initialUrl = normalizeStartUrl(searchParams.get("url") ?? "");
  const initialExcludesParam = searchParams.get("excludes") ?? "";
  const initialExcludePatterns = useMemo(
    () =>
      initialExcludesParam
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean),
    [initialExcludesParam],
  );
  const initialPatternsAreRegex =
    searchParams.get("patternsAreRegex") === "1" ||
    searchParams.get("patternsAreRegex") === "true";
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
  const addPathSourceIdParam = searchParams.get("sourceId");
  const pathScopedMode = searchParams.get("mode");
  const isAddPathMode =
    pathScopedMode === "add-path" && Boolean(addPathSourceIdParam);
  const isUpdatePathMode =
    pathScopedMode === "update-path" && Boolean(addPathSourceIdParam);
  const isPathScopedMode = isAddPathMode || isUpdatePathMode;
  const pathScopedStartUrls = useMemo(() => {
    const raw = searchParams.get("urls");
    if (!raw) {
      return initialUrl ? [initialUrl] : [];
    }
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) {
        return initialUrl ? [initialUrl] : [];
      }
      const urls = parsed
        .filter((item): item is string => typeof item === "string")
        .map((url) => normalizeStartUrl(url))
        .filter(Boolean);
      return urls.length > 0 ? [...new Set(urls)] : initialUrl ? [initialUrl] : [];
    } catch {
      return initialUrl ? [initialUrl] : [];
    }
  }, [searchParams, initialUrl]);
  const shouldRestoreSession = useRef(
    searchParams.get("fresh") !== "1" &&
      !searchParams.get("url") &&
      !isRefreshSelect &&
      !isPathScopedMode,
  );

  function handleScopeChange(next: KnowledgeSetScope) {
    if (toolbarLocked) return;
    if (next === sourceScope) return;
    // Public catalog publish is admin-only.
    if (next === "global" && !isAdmin) return;

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

  useEffect(() => {
    if (isAdmin || sourceScope !== "global") return;
    const params = new URLSearchParams(searchParams.toString());
    params.delete("scope");
    const query = params.toString();
    router.replace(query ? `/sources/web-crawl?${query}` : "/sources/web-crawl");
  }, [isAdmin, sourceScope, router, searchParams]);

  const [step, setStep] = useState<1 | 2>(1);
  const [primaryStartUrl, setPrimaryStartUrl] = useState(initialUrl);
  const [additionalStartUrls, setAdditionalStartUrls] = useState<string[]>([]);

  // Keep input in sync when landing with ?url= (e.g. catalog → Add source).
  useEffect(() => {
    if (!initialUrl) return;
    setPrimaryStartUrl(initialUrl);
  }, [initialUrl]);

  useEffect(() => {
    if (initialExcludePatterns.length === 0) return;
    setExcludePatternsText(initialExcludePatterns.join("\n"));
  }, [initialExcludePatterns]);

  useEffect(() => {
    setPatternsAreRegex(initialPatternsAreRegex);
  }, [initialPatternsAreRegex]);
  const [sourceName, setSourceName] = useState("");
  const [sourceSlug, setSourceSlug] = useState("");
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
  const [excludePatternsText, setExcludePatternsText] = useState(
    () => initialExcludePatterns.join("\n"),
  );
  const [autoDiscoverExcludes, setAutoDiscoverExcludes] = useState(false);
  const autoDiscoverExcludesRef = useRef(false);
  const excludePatternsTextRef = useRef(excludePatternsText);
  const patternsAreRegexRef = useRef(initialPatternsAreRegex);
  const autoDiscoverAppliedForRunRef = useRef<string | null>(null);
  const [autoExcludePhase, setAutoExcludePhase] = useState<
    "idle" | "analysing" | "done"
  >("idle");
  const [autoExcludeResult, setAutoExcludeResult] = useState<{
    scanned: number;
    added: number;
    dropped: number;
    summary?: string;
  } | null>(null);
  const [httpCleanupPhase, setHttpCleanupPhase] = useState<
    "idle" | "cleaning" | "done"
  >("idle");
  const [httpCleanupResult, setHttpCleanupResult] = useState<{
    filtered: number;
    keptInList?: boolean;
  } | null>(null);
  const [liveCrawlPhase, setLiveCrawlPhase] = useState<
    "discovering" | "validating"
  >("discovering");
  const [liveValidation, setLiveValidation] = useState<{
    done: number;
    total: number;
    errors: number;
  } | null>(null);
  const [patternsAreRegex, setPatternsAreRegex] = useState(
    initialPatternsAreRegex,
  );
  const [enableSitemap, setEnableSitemap] = useState(true);
  const [sitemapOnly, setSitemapOnly] = useState(false);
  const [discoverHeaderNav, setDiscoverHeaderNav] = useState(false);
  const [headerNavStatus, setHeaderNavStatus] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [headerNavSeed, setHeaderNavSeed] = useState<HeaderNavPath | null>(
    null,
  );
  const [headerNavPaths, setHeaderNavPaths] = useState<HeaderNavPath[]>([]);
  const [headerNavReason, setHeaderNavReason] = useState<string | null>(null);
  const [headerNavDownloading, setHeaderNavDownloading] = useState(false);
  const [stagehandRuntimeStatus, setStagehandRuntimeStatus] =
    useState<StagehandRuntimeStatus | null>(null);
  const [headerNavBrowserMode, setHeaderNavBrowserMode] =
    useState<HeaderNavBrowserRuntime>("playwright");
  const [stagehandRuntimeInstalling, setStagehandRuntimeInstalling] =
    useState(false);
  const [stagehandInstallError, setStagehandInstallError] = useState<
    string | null
  >(null);
  const headerNavAbortRef = useRef<AbortController | null>(null);
  const headerNavScanKeyRef = useRef<string | null>(null);
  const runHeaderNavDiscoveryRef = useRef<(() => Promise<void>) | null>(null);
  const isDesktopShell = Boolean(getLedgeIndexDesktop());
  const stagehandRuntimeManageable = canManageStagehandRuntimeOnApi();
  const headerNavDiscoveryApiBase = resolveHeaderNavDiscoveryApiBase();
  const headerNavApiOptions = useMemo(
    () =>
      headerNavDiscoveryApiBase
        ? { baseUrl: headerNavDiscoveryApiBase }
        : undefined,
    [headerNavDiscoveryApiBase],
  );

  const headerNavBrowserReady = useMemo(() => {
    if (!stagehandRuntimeStatus) return null;
    if (headerNavBrowserMode === "system") {
      return stagehandRuntimeStatus.readyWithSystemBrowser;
    }
    return stagehandRuntimeStatus.installed;
  }, [stagehandRuntimeStatus, headerNavBrowserMode]);
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
  const versionResolutionRef = useRef(versionResolution);
  versionResolutionRef.current = versionResolution;
  const [pendingDuplicate, setPendingDuplicate] =
    useState<SourceDuplicateMatch | null>(null);
  const [duplicateModalOpen, setDuplicateModalOpen] = useState(false);
  const [sitemapModalOpen, setSitemapModalOpen] = useState(false);
  const [robotsModalOpen, setRobotsModalOpen] = useState(false);
  const [pendingCrawlAfterResolution, setPendingCrawlAfterResolution] =
    useState(false);
  const [crawlRun, setCrawlRun] = useState<CrawlRun | null>(null);
  const [parsePages, setParsePages] = useState<ParsePreviewPage[]>([]);
  const [agentGuideSourceId, setAgentGuideSourceId] = useState<string | null>(
    null,
  );
  const [activePreviewTab, setActivePreviewTab] = useState(0);
  const [selectedPreviewUrls, setSelectedPreviewUrls] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [copiedSelection, setCopiedSelection] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const [excludePickerUrl, setExcludePickerUrl] = useState<string | null>(null);
  const [excludeHoverIndex, setExcludeHoverIndex] = useState<number | null>(
    null,
  );

  useEffect(() => {
    if (!excludePickerUrl) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setExcludePickerUrl(null);
        setExcludeHoverIndex(null);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [excludePickerUrl]);
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
  const addPathStartedRef = useRef(false);
  const [addPathReady, setAddPathReady] = useState(false);
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
  const { canonicalAliasCount, httpStatusCount, otherSkippedCount } = useMemo(
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
          if (progress.phase === "validating" || progress.phase === "discovering") {
            setLiveCrawlPhase(progress.phase);
          }
          if (progress.phase === "validating") {
            setLiveValidation({
              done: progress.validatedCount ?? 0,
              total: progress.validationTotal ?? 0,
              errors: progress.httpErrorCount ?? 0,
            });
            setHttpCleanupPhase("cleaning");
          }
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

  const filterPipelinePhase = (():
    | "idle"
    | "discovering"
    | "http"
    | "auto-exclude"
    | "done" => {
    if (autoExcludePhase === "analysing") return "auto-exclude";
    if (
      httpCleanupPhase === "cleaning" ||
      (crawlCardPhase === "crawling" && liveCrawlPhase === "validating")
    ) {
      return "http";
    }
    if (
      httpCleanupPhase === "done" ||
      autoExcludePhase === "done"
    ) {
      return "done";
    }
    if (crawlCardPhase === "crawling") return "discovering";
    return "idle";
  })();

  const filterPipelineDetail =
    filterPipelinePhase === "auto-exclude"
      ? "Filter (AI)…"
      : filterPipelinePhase === "http"
        ? liveValidation && liveValidation.total > 0
          ? `Checking HTTP ${liveValidation.done}/${liveValidation.total}…`
          : "Dropping non-2xx pages…"
        : filterPipelinePhase === "done" && httpCleanupResult
          ? httpCleanupResult.keptInList
            ? `Marked ${httpCleanupResult.filtered} error page${httpCleanupResult.filtered === 1 ? "" : "s"}`
            : `Removed ${httpCleanupResult.filtered} error page${httpCleanupResult.filtered === 1 ? "" : "s"}`
          : undefined;

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
        filterPhase: filterPipelinePhase,
        filterDetail: filterPipelineDetail,
        httpErrorCount: httpCleanupResult?.filtered,
        showFilterStep: autoDiscoverExcludes,
      }),
    [
      ingestSnapshot?.pipeline,
      ingestSnapshot?.result?.chunkCount,
      busy,
      discoveredUrls.length,
      config.maxPages,
      selectedPreviewUrls.length,
      parsePages.length,
      filterPipelinePhase,
      filterPipelineDetail,
      httpCleanupResult?.filtered,
      autoDiscoverExcludes,
    ],
  );

  const pipelineAnimating =
    Boolean(busy) ||
    filterPipelinePhase === "http" ||
    filterPipelinePhase === "auto-exclude";
  const toolbarLocked = Boolean(busy);
  /** Storage/hosting must not change mid-crawl — source is created on one API. */
  const storageSelectionLocked =
    Boolean(sourceId) ||
    toolbarLocked ||
    crawlCardPhase !== "idle" ||
    Boolean(ingestRunId);
  const didInitialPreflight = useRef(false);

  const toggleHeaderNavPath = useCallback((url: string) => {
    const normalized = normalizeStartUrl(url);
    const primary = normalizeStartUrl(primaryStartUrl);
    if (!normalized || normalized === primary) return;
    setAdditionalStartUrls((current) => {
      const exists = current.some(
        (item) => normalizeStartUrl(item) === normalized,
      );
      if (exists) {
        return current.filter(
          (item) => normalizeStartUrl(item) !== normalized,
        );
      }
      return [...current, normalized];
    });
  }, [primaryStartUrl]);

  useEffect(() => {
    if (!discoverHeaderNav) return;
    const controller = new AbortController();
    void getStagehandRuntimeStatus(controller.signal, headerNavApiOptions)
      .then((status) => {
        setStagehandRuntimeStatus(status);
        setHeaderNavBrowserMode((prev) => {
          if (prev === "system" && status.readyWithSystemBrowser) return "system";
          if (prev === "playwright" && status.installed) return "playwright";
          return status.readyWithSystemBrowser ? "system" : "playwright";
        });
      })
      .catch(() => setStagehandRuntimeStatus(null));
    return () => controller.abort();
  }, [discoverHeaderNav, headerNavApiOptions]);

  useEffect(() => {
    if (
      !stagehandRuntimeManageable ||
      (!stagehandRuntimeInstalling && headerNavStatus !== "loading")
    ) {
      setHeaderNavDownloading(false);
      return;
    }

    let cancelled = false;
    const poll = async () => {
      try {
        const status = await getStagehandRuntimeStatus(undefined, headerNavApiOptions);
        if (cancelled) return;
        setHeaderNavDownloading(!status.installed || status.installing);
      } catch {
        if (!cancelled) setHeaderNavDownloading(false);
      }
    };

    void poll();
    const timer = window.setInterval(() => void poll(), 1500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [stagehandRuntimeManageable, headerNavStatus, stagehandRuntimeInstalling, headerNavApiOptions]);

  const runHeaderNavDiscovery = useCallback(async () => {
    if (headerNavBrowserReady !== true) {
      return;
    }

    const url = normalizeStartUrl(primaryStartUrl.trim());
    if (!url) {
      setHeaderNavStatus("idle");
      return;
    }

    headerNavAbortRef.current?.abort();
    const controller = new AbortController();
    headerNavAbortRef.current = controller;
    setHeaderNavStatus("loading");
    setHeaderNavReason(null);
    setHeaderNavSeed({ url, label: headerNavLabel(url) });
    setHeaderNavPaths([]);

    try {
      const result = await discoverHeaderNavPaths(
        url,
        controller.signal,
        readCrawlProvider() ?? undefined,
        headerNavBrowserMode,
        headerNavApiOptions,
      );
      if (controller.signal.aborted) return;
      setHeaderNavSeed(result.seed);
      setHeaderNavPaths(result.paths);
      setHeaderNavReason(result.reason);
      setHeaderNavStatus("ready");
    } catch (error) {
      if (
        controller.signal.aborted ||
        (error instanceof DOMException && error.name === "AbortError") ||
        (error instanceof Error && error.name === "AbortError")
      ) {
        return;
      }
      if (
        error instanceof KnowledgeIndexApiError &&
        (error.status === 404 || error.status === 501 || error.status === 0)
      ) {
        setHeaderNavStatus("idle");
        setHeaderNavPaths([]);
        setHeaderNavReason(null);
        return;
      }
      if (
        error instanceof KnowledgeIndexApiError &&
        error.status === 503 &&
        stagehandRuntimeManageable &&
        headerNavBrowserMode === "playwright"
      ) {
        setStagehandRuntimeStatus((prev) =>
          prev ? { ...prev, installed: false } : prev,
        );
        setHeaderNavStatus("idle");
        setHeaderNavPaths([]);
        setHeaderNavReason(null);
        return;
      }
      setHeaderNavStatus("ready");
      setHeaderNavPaths([]);
      setHeaderNavReason(
        error instanceof KnowledgeIndexApiError
          ? error.message
          : error instanceof Error
            ? error.message
            : null,
      );
    }
  }, [
    headerNavApiOptions,
    headerNavBrowserMode,
    headerNavBrowserReady,
    primaryStartUrl,
    stagehandRuntimeManageable,
  ]);

  runHeaderNavDiscoveryRef.current = runHeaderNavDiscovery;

  const installStagehandRuntimeClick = useCallback(async () => {
    if (!stagehandRuntimeManageable || stagehandRuntimeInstalling) return;
    setStagehandInstallError(null);
    setStagehandRuntimeInstalling(true);
    setHeaderNavBrowserMode("playwright");
    try {
      const status = await installStagehandRuntime(undefined, headerNavApiOptions);
      setStagehandRuntimeStatus(status);
      if (
        status.installed &&
        discoverHeaderNav &&
        isValidStartUrl(primaryStartUrl)
      ) {
        void runHeaderNavDiscovery();
      }
    } catch (error) {
      setStagehandInstallError(
        error instanceof KnowledgeIndexApiError
          ? error.message
          : error instanceof Error
            ? error.message
            : "Download failed",
      );
    } finally {
      setStagehandRuntimeInstalling(false);
    }
  }, [
    discoverHeaderNav,
    headerNavApiOptions,
    stagehandRuntimeManageable,
    primaryStartUrl,
    runHeaderNavDiscovery,
    stagehandRuntimeInstalling,
  ]);

  useEffect(() => {
    if (!discoverHeaderNav) {
      headerNavScanKeyRef.current = null;
      return;
    }
    if (headerNavBrowserReady !== true) return;
    const url = normalizeStartUrl(primaryStartUrl.trim());
    if (!url || !isValidStartUrl(primaryStartUrl)) {
      headerNavAbortRef.current?.abort();
      setHeaderNavStatus("idle");
      setHeaderNavReason(null);
      setHeaderNavPaths([]);
      headerNavScanKeyRef.current = null;
      return;
    }

    const scanKey = `${url}|${headerNavBrowserMode}`;
    if (headerNavScanKeyRef.current === scanKey) return;
    headerNavScanKeyRef.current = scanKey;

    const timer = window.setTimeout(() => {
      void runHeaderNavDiscoveryRef.current?.();
    }, 500);

    return () => {
      window.clearTimeout(timer);
    };
  }, [
    discoverHeaderNav,
    headerNavBrowserMode,
    headerNavBrowserReady,
    primaryStartUrl,
  ]);

  useEffect(() => {
    if (!discoverHeaderNav || stagehandRuntimeManageable) return;
    if (headerNavBrowserReady !== false) return;
    setHeaderNavStatus("ready");
    setHeaderNavPaths([]);
    setHeaderNavReason(
      "Header nav needs a browser on the API server. Use local dev (API on :3010) or the desktop app.",
    );
  }, [discoverHeaderNav, headerNavBrowserReady, stagehandRuntimeManageable]);

  useEffect(() => {
    autoDiscoverExcludesRef.current = autoDiscoverExcludes;
  }, [autoDiscoverExcludes]);

  useEffect(() => {
    excludePatternsTextRef.current = excludePatternsText;
  }, [excludePatternsText]);

  useEffect(() => {
    patternsAreRegexRef.current = patternsAreRegex;
  }, [patternsAreRegex]);

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
    setSourceSlug("");
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
      setSourceSlug("");
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
    setSourceSlug("");
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
      setSourceSlug(preflight.siteSlug);
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
      setSourceSlug("");
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
    if (isReplaceRecrawl || isPathScopedMode) return;
    versionResolutionRef.current = null;
    setVersionResolution(null);
    setPendingDuplicate(null);
    setDuplicateModalOpen(false);
  }, [primaryStartUrl, isReplaceRecrawl, isPathScopedMode]);

  useEffect(() => {
    if (
      !initialUrl ||
      didInitialPreflight.current ||
      isRefreshSelect ||
      isPathScopedMode
    )
      return;
    didInitialPreflight.current = true;
    void runPreflight(initialUrl);
  }, [initialUrl, isRefreshSelect, isPathScopedMode, runPreflight]);

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
        setSourceSlug(source.slug ?? "");
        setPrimaryStartUrl(primary ?? "");
        setAdditionalStartUrls(rest);
        setIncludePatternsText(cfg.includePatterns.join("\n"));
        setExcludePatternsText(cfg.excludePatterns.join("\n"));
        setPatternsAreRegex(cfg.patternsAreRegex);
        setEnableSitemap(cfg.enableSitemap);
        setSitemapOnly(cfg.sitemapOnly ?? false);
        setSitemapUrlsText((cfg.sitemapUrls ?? []).join("\n"));
        setMaxPages(Math.max(cfg.maxPages ?? 0, DEFAULT_MAX_CRAWL_PAGES));
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
    if (!isPathScopedMode || !addPathSourceIdParam) return;
    const scopedUrls =
      pathScopedStartUrls.length > 0
        ? pathScopedStartUrls
        : initialUrl
          ? [normalizeStartUrl(initialUrl)]
          : [];
    if (scopedUrls.length === 0) return;

    let cancelled = false;

    void (async () => {
      try {
        const { source } = await getSource(addPathSourceIdParam);
        if (cancelled) return;

        const cfg = source.config;
        const scopedSet = new Set(
          scopedUrls.map((url) => url.replace(/\/$/, "")),
        );
        const remaining = (cfg.startUrls ?? [])
          .map((url) => normalizeStartUrl(url))
          .filter((url) => !scopedSet.has(url.replace(/\/$/, "")));

        // Keep full start URL list on the source; crawl only scoped roots.
        const primary = scopedUrls[0]!;
        const additional = [
          ...scopedUrls.slice(1),
          ...remaining,
        ];

        setSourceId(source.id);
        setSourceName(source.name);
        setSourceSlug(source.slug ?? "");
        setPrimaryStartUrl(primary);
        setAdditionalStartUrls(additional);
        setIncludePatternsText(cfg.includePatterns.join("\n"));
        setExcludePatternsText(cfg.excludePatterns.join("\n"));
        setPatternsAreRegex(cfg.patternsAreRegex);
        setEnableSitemap(cfg.enableSitemap);
        setSitemapOnly(cfg.sitemapOnly ?? false);
        setSitemapUrlsText((cfg.sitemapUrls ?? []).join("\n"));
        setMaxPages(Math.max(cfg.maxPages ?? 0, DEFAULT_MAX_CRAWL_PAGES));
        setRenderJs(cfg.renderJs);
        setContentSelectorsText(cfg.contentSelectors.join(", "));
        setExcludeSelectorsText(cfg.excludeSelectors.join(", "));
        setPreflightOgImage(source.ogImageUrl ?? null);
        setPreflightFaviconUrl(source.faviconUrl ?? null);
        setSourceMetadata(source.sourceMetadata ?? null);
        if (source.hosting === "local" || source.hosting === "cloud") {
          setSourceHosting(source.hosting);
        }
        setPreflightState("ok");
        setPreflightCheckedUrl(primary);
        setAddPathReady(true);
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Failed to load source for path crawl",
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    isPathScopedMode,
    addPathSourceIdParam,
    initialUrl,
    pathScopedStartUrls,
  ]);

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

    if (preflightCheckedUrl && !sameStartUrlForBranding(url, preflightCheckedUrl)) {
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
      if (isPathScopedMode) {
        router.push(dashboardIndexRedirectUrl(id, sourceScope));
      } else {
        setAgentGuideSourceId(id);
      }
    },
    [isPathScopedMode, router, sourceScope],
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
    const resolution = versionResolutionRef.current;
    if (!resolution) return {};
    return {
      versionMode: resolution.mode,
      replaceSourceId: resolution.replaceSourceId,
      versionLabel: resolution.versionLabel || undefined,
    };
  }

  function metadataWithVersionLabel(): SourceMetadata | undefined {
    const resolution = versionResolutionRef.current;
    if (!sourceMetadata) return undefined;
    if (!resolution?.versionLabel) return sourceMetadata;
    return { ...sourceMetadata, version: resolution.versionLabel };
  }

  async function resolveSourceBranding(): Promise<{
    ogImageUrl: string | null;
    faviconUrl: string | null;
  }> {
    const startUrl =
      normalizeStartUrl(primaryStartUrl.trim()) || config.startUrls[0] || "";

    if (preflightOgImage && preflightFaviconUrl) {
      return { ogImageUrl: preflightOgImage, faviconUrl: preflightFaviconUrl };
    }

    if (!startUrl) {
      return { ogImageUrl: preflightOgImage, faviconUrl: preflightFaviconUrl };
    }

    try {
      const { preflight } = await preflightSite(startUrl);
      const ogImageUrl = preflightOgImage ?? preflight.ogImage ?? null;
      const faviconUrl = preflightFaviconUrl ?? preflight.faviconUrl ?? null;
      if (ogImageUrl !== preflightOgImage) setPreflightOgImage(ogImageUrl);
      if (faviconUrl !== preflightFaviconUrl) {
        setPreflightFaviconUrl(faviconUrl);
      }
      return { ogImageUrl, faviconUrl };
    } catch {
      return { ogImageUrl: preflightOgImage, faviconUrl: preflightFaviconUrl };
    }
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
      ...(sourceSlug.trim() ? { slug: sourceSlug.trim() } : {}),
      scope: sourceScope as "personal" | "global",
      hosting,
      config,
      ...(sourceMetadataPayload
        ? { sourceMetadata: sourceMetadataPayload }
        : {}),
      ...versionCreatePayload(),
    };

    if (sourceScope === "global") {
      try {
        const { source } = await createSource(createInput);
        setSourceId(source.id);
        return source.id;
      } catch (error) {
        if (error instanceof KnowledgeIndexApiError && error.status === 403) {
          showPlanLimit(error.message);
        }
        throw error;
      }
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
      if (error instanceof KnowledgeIndexApiError && error.status === 403) {
        showPlanLimit(error.message);
        throw error;
      }
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
    if (isPathScopedMode && sourceId) {
      return sourceId;
    }

    const resolution = versionResolutionRef.current;
    if (resolution?.mode === "replace" && resolution.replaceSourceId) {
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
    if (isPathScopedMode || versionResolutionRef.current || sourceId) return true;

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
    // Write the ref first — confirm immediately restarts crawl, and React
    // state would still be null in that same turn (modal would reopen).
    versionResolutionRef.current = choice;
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
    setAutoExcludePhase("idle");
    setAutoExcludeResult(null);
    setHttpCleanupPhase("idle");
    setHttpCleanupResult(null);
    setLiveCrawlPhase("discovering");
    setLiveValidation(null);
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
        urls?: DiscoveredReviewUrl[];
        skipped?: { url: string; reason: string }[];
        pagesDiscovered?: number;
        httpStatusFiltered?: number;
      };

      const rawUrls = payload.urls ?? [];
      const rawSkipped = payload.skipped ?? [];

      // Filter off → keep HTTP error pages in the review list (marked), not only skipped.
      // Filter on → leave them stripped; AI filter may drop more.
      const keepHttpErrorsInList = !autoDiscoverExcludesRef.current;
      const promoted: {
        urls: DiscoveredReviewUrl[];
        skipped: { url: string; reason: string }[];
        httpErrorCount: number;
      } = keepHttpErrorsInList
        ? promoteHttpErrorsIntoReviewList(rawUrls, rawSkipped)
        : {
            urls: rawUrls,
            skipped: rawSkipped,
            httpErrorCount: Math.max(
              payload.httpStatusFiltered ?? 0,
              rawSkipped.filter((item) => isHttpStatusSkipReason(item.reason))
                .length,
            ),
          };

      const urls: DiscoveredReviewUrl[] = promoted.urls;
      const skipped = promoted.skipped;
      setCrawlRun({
        id: snapshot.runId,
        sourceId: id,
        kind: "preview",
        status: "completed",
        pagesDiscovered: payload.pagesDiscovered ?? urls.length,
        result: {
          urls,
          skipped,
        },
      });

      if (urls.length > 0) {
        const selectable = urls.filter(
          (item) => item.httpStatus == null && !item.httpErrorReason,
        );
        setSelectedPreviewUrls((current) => {
          const reconciled = reconcilePreviewSelection(
            selectable,
            isRefreshSelect && catalogSelectionRef.current.length > 0
              ? catalogSelectionRef.current
              : current,
          );
          const existing = linesToList(excludePatternsTextRef.current);
          if (existing.length === 0) return reconciled;
          return filterUrlsByExcludePatterns(
            reconciled,
            existing,
            patternsAreRegexRef.current,
          );
        });
        setCrawlCardPhase("complete");
        await announceHttpStatusCleanup(rawSkipped, payload.httpStatusFiltered, {
          keptInList: keepHttpErrorsInList,
        });
        await applyAutoDiscoveredExcludes(urls, snapshot.runId);
      } else {
        setSelectedPreviewUrls([]);
        setCrawlCardPhase("complete");
        await announceHttpStatusCleanup(rawSkipped, payload.httpStatusFiltered, {
          keptInList: keepHttpErrorsInList,
        });
      }

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
    if (event.altKey) {
      excludePathSegment(segment);
      return;
    }

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

  function applyExcludePatterns(patterns: string[]) {
    const normalized = [
      ...new Set(patterns.map((pattern) => pattern.trim()).filter(Boolean)),
    ];
    setExcludePatternsText(normalized.join("\n"));
    if (normalized.length === 0) {
      setIndexEstimate(null);
      return;
    }
    setSelectedPreviewUrls((current) =>
      current.filter(
        (url) => !urlMatchesAnyPattern(url, normalized, patternsAreRegex),
      ),
    );
    setIndexEstimate(null);
  }

  function handleExcludePatternsTextChange(value: string) {
    setExcludePatternsText(value);
    const patterns = linesToList(value);
    if (patterns.length === 0) {
      setIndexEstimate(null);
      return;
    }
    setSelectedPreviewUrls((current) =>
      current.filter(
        (url) => !urlMatchesAnyPattern(url, patterns, patternsAreRegex),
      ),
    );
    setIndexEstimate(null);
  }

  function suggestExcludePatternsFromDiscovered() {
    const urls = discoveredUrls.map((item) => item.url);
    if (urls.length === 0) return;
    const suggested = discoverExcludePatternsFromUrls(urls, {
      startUrls: config.startUrls,
      existing: linesToList(excludePatternsText),
    });
    if (suggested.length === 0) return;
    applyExcludePatterns(
      mergeExcludePatterns(linesToList(excludePatternsText), suggested),
    );
  }

  async function announceHttpStatusCleanup(
    skipped: Array<{ url: string; reason: string }>,
    httpStatusFiltered?: number,
    options?: { keptInList?: boolean },
  ) {
    const fromSkipped = skipped.filter((item) =>
      isHttpStatusSkipReason(item.reason),
    ).length;
    const filtered = Math.max(httpStatusFiltered ?? 0, fromSkipped);

    setHttpCleanupPhase("cleaning");
    setHttpCleanupResult({
      filtered,
      keptInList: Boolean(options?.keptInList) && filtered > 0,
    });
    setLiveCrawlPhase("validating");

    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, filtered > 0 ? 850 : 450);
    });

    setHttpCleanupPhase("done");
    setLiveValidation(null);
  }

  async function applyAutoDiscoveredExcludes(
    urls: Array<{ url: string; title?: string }>,
    runId: string,
  ) {
    if (!autoDiscoverExcludesRef.current) return;
    if (autoDiscoverAppliedForRunRef.current === runId) return;
    autoDiscoverAppliedForRunRef.current = runId;

    const urlList = urls.map((item) => item.url);
    setAutoExcludePhase("analysing");
    setAutoExcludeResult({
      scanned: urlList.length,
      added: 0,
      dropped: 0,
      summary: "AI filtering versions and broken pages…",
    });

    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, 80);
    });

    const existing = linesToList(excludePatternsTextRef.current);
    const suggested = discoverExcludePatternsFromUrls(urlList, {
      startUrls: config.startUrls,
      existing,
    });
    let patternsToApply =
      suggested.length > 0
        ? mergeExcludePatterns(existing, suggested)
        : existing;
    let aiPatternCount = 0;

    if (suggested.length > 0) {
      setExcludePatternsText(patternsToApply.join("\n"));
      setIndexEstimate(null);
    }

    let nextSelected = filterUrlsByExcludePatterns(
      urlList,
      patternsToApply,
      patternsAreRegexRef.current,
    );
    let summary =
      suggested.length > 0
        ? `Added ${suggested.length} version/noise exclude pattern${suggested.length === 1 ? "" : "s"}.`
        : "";

    try {
      setAutoExcludeResult({
        scanned: urlList.length,
        added: suggested.length,
        dropped: 0,
        summary: "AI proposing removals (indexes + exclude patterns)…",
      });

      // One pass: compact index|path|title; AI returns only what to remove.
      const crawlProvider = readCrawlProvider();
      const ai = await proposeCrawlFilterRemovals({
        startUrls: config.startUrls,
        urls: urls.map((item, index) => ({
          index,
          url: item.url,
          ...(item.title?.trim() ? { title: item.title.trim() } : {}),
        })),
        ...(crawlProvider
          ? { modelId: crawlModelIdForProvider(crawlProvider) }
          : {}),
      });

      const removeSet = new Set(ai.removeIndexes);

      if (ai.excludePatterns.length > 0) {
        const before = patternsToApply.length;
        patternsToApply = mergeExcludePatterns(
          patternsToApply,
          ai.excludePatterns,
        );
        aiPatternCount = Math.max(0, patternsToApply.length - before);
        setExcludePatternsText(patternsToApply.join("\n"));
        setIndexEstimate(null);
      }

      const allowedByPattern = new Set(
        filterUrlsByExcludePatterns(
          urlList,
          patternsToApply,
          patternsAreRegexRef.current,
        ),
      );
      nextSelected = urls
        .filter(
          (item, index) =>
            !removeSet.has(index) && allowedByPattern.has(item.url),
        )
        .map((item) => item.url);

      summary = ai.summary?.trim()
        ? [summary, ai.summary.trim()].filter(Boolean).join(" ")
        : [
            summary,
            `AI removed ${ai.removeIndexes.length} URL(s)` +
              (aiPatternCount
                ? `, +${aiPatternCount} exclude pattern(s).`
                : "."),
          ]
            .filter(Boolean)
            .join(" ");
    } catch (err) {
      const message =
        err instanceof KnowledgeIndexApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "AI filter failed";
      summary = [summary, `AI skipped (${message}).`].filter(Boolean).join(" ");
    }

    const dropped = Math.max(0, urlList.length - nextSelected.length);
    const keptSet = new Set(nextSelected);
    const removed = urls.filter((item) => !keptSet.has(item.url));
    const patternsAdded = suggested.length + aiPatternCount;

    // Drop filtered URLs from the review list (not just uncheck) so Filtering is visible.
    if (removed.length > 0) {
      setCrawlRun((current) => {
        if (!current?.result || current.id !== runId) return current;
        return {
          ...current,
          pagesDiscovered: nextSelected.length,
          result: {
            urls: urls.filter((item) => keptSet.has(item.url)),
            skipped: [
              ...(current.result.skipped ?? []),
              ...removed.map((item) => ({
                url: item.url,
                reason: "Filter",
              })),
            ],
          },
        };
      });
    }

    setSelectedPreviewUrls(nextSelected);
    setAutoExcludeResult({
      scanned: urlList.length,
      added: patternsAdded,
      dropped,
      summary:
        dropped > 0
          ? `${summary} Dropped ${dropped} URL(s).`
          : summary,
    });
    setAutoExcludePhase("done");
  }

  function excludePathSegment(segment: string) {
    const pattern = excludePatternForPathSegment(segment);
    const next = [...linesToList(excludePatternsText)];
    if (!next.includes(pattern)) next.push(pattern);
    applyExcludePatterns(next);
    setExcludePickerUrl(null);
    setExcludeHoverIndex(null);
  }

  function confirmExcludePathPrefix(url: string, endIndex: number) {
    const parts = parseUrlPathParts(url);
    if (!parts || endIndex < 0) return;
    const pattern = excludePatternFromPathPrefix(parts.segments, endIndex);
    const next = [...linesToList(excludePatternsText)];
    if (!next.includes(pattern)) next.push(pattern);
    applyExcludePatterns(next);
    setExcludePickerUrl(null);
    setExcludeHoverIndex(null);
  }

  function startExcludePicker(url: string) {
    setExcludePickerUrl(url);
    setExcludeHoverIndex(null);
  }

  function cancelExcludePicker() {
    setExcludePickerUrl(null);
    setExcludeHoverIndex(null);
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
    if (discoverHeaderNav && headerNavStatus === "loading") return;
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
    setAutoExcludePhase("idle");
    setAutoExcludeResult(null);
    autoDiscoverAppliedForRunRef.current = null;
    setHttpCleanupPhase("idle");
    setHttpCleanupResult(null);
    setLiveCrawlPhase("discovering");
    setLiveValidation(null);
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
      const branding = await resolveSourceBranding();
      await updateSource(id, {
        name: isPathScopedMode
          ? sourceName
          : resolveSourceName(sourceName, primaryStartUrl),
        config,
        ogImageUrl: branding.ogImageUrl,
        faviconUrl: branding.faviconUrl,
        ...(sourceMetadataPayload
          ? { sourceMetadata: sourceMetadataPayload }
          : {}),
      });
      const crawlConfig = isPathScopedMode
        ? {
            ...config,
            startUrls:
              pathScopedStartUrls.length > 0
                ? pathScopedStartUrls
                : [normalizeStartUrl(primaryStartUrl.trim())].filter(Boolean),
          }
        : config;
      const { snapshot } = await startIngestWorkflow(
        id,
        { config: crawlConfig },
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

  useEffect(() => {
    if (!isPathScopedMode || !addPathReady || addPathStartedRef.current) {
      return;
    }
    if (!primaryStartUrl.trim()) return;

    addPathStartedRef.current = true;
    void handleCrawlPreview();
  }, [isPathScopedMode, addPathReady, primaryStartUrl]);

  async function handleContinueToExtraction() {
    if (selectedPreviewUrls.length === 0) return;
    setError(null);
    setBusy("parse");
    try {
      const id = await ensureSource();
      const branding = await resolveSourceBranding();
      await updateSource(id, {
        config,
        ogImageUrl: branding.ogImageUrl,
        faviconUrl: branding.faviconUrl,
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
      const branding = await resolveSourceBranding();
      await updateSource(id, {
        name: isPathScopedMode
          ? sourceName
          : resolveSourceName(sourceName, primaryStartUrl),
        config,
        ogImageUrl: branding.ogImageUrl,
        faviconUrl: branding.faviconUrl,
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
        if (isPathScopedMode) {
          router.push(dashboardIndexRedirectUrl(id, sourceScope));
        } else {
          setAgentGuideSourceId(id);
        }
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
    setSelectedPreviewUrls(
      discoveredUrls
        .filter((item) => item.httpStatus == null && !item.httpErrorReason)
        .map((item) => item.url),
    );
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

  async function copySingleUrl(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedUrl(url);
      window.setTimeout(() => {
        setCopiedUrl((current) => (current === url ? null : current));
      }, 1500);
    } catch {
      setError("Could not copy URL to clipboard");
    }
  }

  const excludePatternCount = linesToList(excludePatternsText).length;

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      {isPathScopedMode ? (
        <div className="shrink-0 border-b border-accent/25 bg-accent/8 px-4 py-2 sm:px-6">
          <p className="mx-auto max-w-[90rem] text-sm text-accent">
            {isUpdatePathMode ? "Updating" : "Adding"}{" "}
            {pathScopedStartUrls.length > 1
              ? `${pathScopedStartUrls.length} start URLs`
              : "start URL"}{" "}
            {pathScopedStartUrls.length <= 1 ? (
              <span className="font-mono font-medium">
                {formatUrlLabel(primaryStartUrl)}
              </span>
            ) : (
              <span className="font-mono font-medium">
                {pathScopedStartUrls
                  .map((url) => formatUrlLabel(url))
                  .join(" · ")}
              </span>
            )}
            {sourceName ? (
              <>
                {" "}
                on <span className="font-medium">{sourceName}</span>
              </>
            ) : null}
            . Other paths stay indexed — this crawl only covers the selected
            root{pathScopedStartUrls.length > 1 ? "s" : ""}.
          </p>
        </div>
      ) : null}
      {error ? (
        <div className="shrink-0 border-b border-red-500/25 bg-red-500/8 px-4 py-2 sm:px-6">
          <p className="mx-auto max-w-[90rem] text-sm text-red-700 dark:text-red-300">
            {error}
          </p>
        </div>
      ) : null}

      <CrawlSettingsToolbarHost desktop={isDesktopShell}>
            <div className="inline-flex min-w-0 items-center gap-px rounded-xl border border-border bg-surface-raised/80 p-0.5 shadow-card">
            <ConfigPill
              label="Scope"
              icon={<ScopeIcon />}
              emphasized={
                httpCleanupPhase === "cleaning" ||
                autoExcludePhase === "analysing" ||
                (crawlCardPhase === "crawling" && liveCrawlPhase === "validating")
              }
              compactSummary={
                httpCleanupPhase === "cleaning" ||
                (crawlCardPhase === "crawling" && liveCrawlPhase === "validating")
                  ? "HTTP"
                  : autoExcludePhase === "analysing"
                    ? "…"
                    : autoExcludePhase === "done" && autoExcludeResult
                      ? `+${autoExcludeResult.added}`
                      : httpCleanupPhase === "done" && httpCleanupResult
                        ? httpCleanupResult.keptInList
                          ? `!${httpCleanupResult.filtered}`
                          : `−${httpCleanupResult.filtered}`
                        : `${maxPages}`
              }
              summary={
                httpCleanupPhase === "cleaning" ||
                (crawlCardPhase === "crawling" && liveCrawlPhase === "validating") ? (
                  <span className="inline-flex items-center gap-1.5 text-accent">
                    <Spinner className="size-3" />
                    {liveValidation && liveValidation.total > 0
                      ? `Checking HTTP ${liveValidation.done}/${liveValidation.total}…`
                      : "Dropping error pages…"}
                  </span>
                ) : autoExcludePhase === "analysing" ? (
                  <span className="inline-flex items-center gap-1.5 text-accent">
                    <Spinner className="size-3" />
                    Filter (AI)…
                  </span>
                ) : autoExcludePhase === "done" && autoExcludeResult ? (
                  `−${autoExcludeResult.dropped} urls · +${autoExcludeResult.added} patterns`
                ) : httpCleanupPhase === "done" && httpCleanupResult ? (
                  httpCleanupResult.keptInList
                    ? `${httpCleanupResult.filtered} error pages marked`
                    : `−${httpCleanupResult.filtered} error pages`
                ) : (
                  `${maxPages} pages${
                    excludePatternCount > 0
                      ? ` · ${excludePatternCount} excludes`
                      : ""
                  }${patternsAreRegex ? " · regex" : ""}`
                )
              }
              description="Crawls only pages at or below your start URL path, plus optional filters."
              disabled={
                toolbarLocked &&
                autoExcludePhase !== "analysing" &&
                httpCleanupPhase !== "cleaning"
              }
            >
              <div className={cn(configPanelInsetClass, "space-y-4")}>
                {httpCleanupPhase === "cleaning" ||
                (crawlCardPhase === "crawling" &&
                  liveCrawlPhase === "validating") ? (
                  <div className="flex items-start gap-2 rounded-lg border border-accent/25 bg-accent/8 px-2.5 py-2">
                    <Spinner className="mt-0.5 size-3.5 shrink-0 text-accent" />
                    <div className="min-w-0">
                      <p className="font-mono text-[0.5625rem] font-semibold tracking-[0.08em] text-accent uppercase">
                        Error pages
                      </p>
                      <p className="mt-0.5 text-[0.6875rem] leading-snug text-muted">
                        Always on · only HTTP 2xx stays; 404, 429, 5xx, and
                        network failures are dropped before pattern excludes.
                        {liveValidation && liveValidation.total > 0
                          ? ` ${liveValidation.done}/${liveValidation.total} checked.`
                          : null}
                      </p>
                    </div>
                  </div>
                ) : null}
                {httpCleanupPhase === "done" && httpCleanupResult ? (
                  <div className="rounded-lg border border-border bg-surface-raised px-2.5 py-2">
                    <p className="font-mono text-[0.5625rem] font-semibold tracking-[0.08em] text-muted uppercase">
                      Error pages
                    </p>
                    <p className="mt-0.5 text-[0.6875rem] leading-snug text-foreground">
                      {httpCleanupResult.keptInList
                        ? `Kept ${httpCleanupResult.filtered} non-2xx URL${httpCleanupResult.filtered === 1 ? "" : "s"} in the list (marked; not selected). Turn Filter on to drop them.`
                        : `Removed ${httpCleanupResult.filtered} URL${httpCleanupResult.filtered === 1 ? "" : "s"} that were not HTTP 2xx (always · no AI).`}
                    </p>
                  </div>
                ) : null}
                {autoExcludePhase === "analysing" ? (
                  <div className="flex items-start gap-2 rounded-lg border border-accent/25 bg-accent/8 px-2.5 py-2">
                    <Spinner className="mt-0.5 size-3.5 shrink-0 text-accent" />
                    <div className="min-w-0">
                      <p className="font-mono text-[0.5625rem] font-semibold tracking-[0.08em] text-accent uppercase">
                        Filter
                      </p>
                      <p className="mt-0.5 text-[0.6875rem] leading-snug text-muted">
                        AI is cleaning the selection: not-found pages and
                        next/previous version trees.
                      </p>
                    </div>
                  </div>
                ) : null}
                {autoExcludePhase === "done" && autoExcludeResult ? (
                  <div className="rounded-lg border border-border bg-surface-raised px-2.5 py-2">
                    <p className="font-mono text-[0.5625rem] font-semibold tracking-[0.08em] text-muted uppercase">
                      Filter
                    </p>
                    <p className="mt-0.5 text-[0.6875rem] leading-snug text-foreground">
                      {autoExcludeResult.summary ??
                        `Scanned ${autoExcludeResult.scanned} · −${autoExcludeResult.dropped} urls · +${autoExcludeResult.added} patterns`}
                    </p>
                  </div>
                ) : null}
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
                    onChange={(e) =>
                      handleExcludePatternsTextChange(e.target.value)
                    }
                    rows={2}
                    spellCheck={false}
                    className="field-input w-full font-mono text-xs leading-5"
                    placeholder="/changelog/"
                  />
                  <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
                    <p className="font-mono text-[0.5rem] text-muted">
                      Saved with the set · used on refresh
                    </p>
                    <button
                      type="button"
                      disabled={
                        toolbarLocked || discoveredUrls.length === 0
                      }
                      onClick={suggestExcludePatternsFromDiscovered}
                      className={cn(
                        "font-mono text-[0.5rem] font-semibold tracking-[0.08em] uppercase transition-colors",
                        toolbarLocked || discoveredUrls.length === 0
                          ? "cursor-not-allowed text-muted/50"
                          : "text-muted hover:text-foreground",
                      )}
                      title="Suggest excludes from version trees, blog, changelog, and similar noise paths in the discovered URL list"
                    >
                      Suggest from URLs
                    </button>
                  </div>
                </div>
              </div>
            </ConfigPill>

            <ToolbarDivider />

            <ConfigPill
              label="Discovery"
              icon={<DiscoveryIcon />}
              compactSummary={
                [
                  enableSitemap
                    ? sitemapOnly
                      ? "Sitemap only"
                      : "Sitemap + links"
                    : "Links",
                  discoverHeaderNav ? "nav" : null,
                  autoDiscoverExcludes ? "filter" : null,
                ]
                  .filter(Boolean)
                  .join(" · ")
              }
              summary={
                [
                  enableSitemap
                    ? sitemapOnly
                      ? "Sitemap only"
                      : "Sitemap + link crawl"
                    : "Links only",
                  discoverHeaderNav ? "header nav" : null,
                  autoDiscoverExcludes ? "filter on" : null,
                ]
                  .filter(Boolean)
                  .join(" · ")
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
              <div className="mt-4 space-y-1 border-t border-border/60 pt-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      Header nav paths
                    </p>
                    <p className="mt-0.5 text-xs text-muted">
                      Suggest sibling docs sections from the site header
                      (guides, reference, …)
                    </p>
                  </div>
                  <Switch
                    checked={discoverHeaderNav}
                    onChange={(on) => {
                      setDiscoverHeaderNav(on);
                      if (!on) {
                        headerNavAbortRef.current?.abort();
                        const navUrls = new Set(
                          headerNavPaths.map((path) =>
                            normalizeStartUrl(path.url),
                          ),
                        );
                        setAdditionalStartUrls((current) =>
                          current.filter(
                            (url) => !navUrls.has(normalizeStartUrl(url)),
                          ),
                        );
                        setHeaderNavStatus("idle");
                      }
                    }}
                    label="Discover header nav paths"
                  />
                </div>
                {stagehandRuntimeManageable &&
                discoverHeaderNav &&
                stagehandRuntimeStatus ? (
                  <div className="space-y-2 border-t border-border/60 pt-3">
                    {stagehandRuntimeStatus.systemBrowser ? (
                      <>
                        <p className="text-xs text-muted">
                          Installed browser detected on the API host:
                        </p>
                        <p
                          className="truncate font-mono text-[0.6875rem] text-muted-strong"
                          title={stagehandRuntimeStatus.systemBrowser.path}
                        >
                          {stagehandRuntimeStatus.systemBrowser.label}
                          {" · "}
                          {stagehandRuntimeStatus.systemBrowser.path}
                        </p>
                        <div className="space-y-2 pt-1">
                          <label className="flex cursor-pointer items-start gap-2 text-xs text-foreground">
                            <input
                              type="radio"
                              name="header-nav-browser"
                              className="mt-0.5"
                              checked={headerNavBrowserMode === "system"}
                              onChange={() =>
                                setHeaderNavBrowserMode("system")
                              }
                            />
                            <span>
                              Use installed{" "}
                              {stagehandRuntimeStatus.systemBrowser.label}{" "}
                              (headless — no extra download)
                            </span>
                          </label>
                          <label className="flex cursor-pointer items-start gap-2 text-xs text-foreground">
                            <input
                              type="radio"
                              name="header-nav-browser"
                              className="mt-0.5"
                              checked={headerNavBrowserMode === "playwright"}
                              onChange={() =>
                                setHeaderNavBrowserMode("playwright")
                              }
                            />
                            <span>
                              Download Playwright Chromium (~150 MB, isolated
                              copy)
                            </span>
                          </label>
                        </div>
                      </>
                    ) : (
                      <p className="text-xs text-muted">
                        No Chrome, Edge, or Chromium found on the API host.
                        Download Playwright Chromium (~150 MB) from Playwright’s
                        CDN on first use
                        {isDesktopShell
                          ? " on this machine"
                          : " into your local API (port 3010)"}
                        .
                      </p>
                    )}
                    {headerNavBrowserMode === "playwright" &&
                    !stagehandRuntimeStatus.installed ? (
                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        <Button
                          type="button"
                          variant="secondary"
                          className="h-8 rounded-full px-4 text-xs"
                          disabled={stagehandRuntimeInstalling}
                          onClick={() => void installStagehandRuntimeClick()}
                        >
                          {stagehandRuntimeInstalling ? (
                            <span className="inline-flex items-center gap-2">
                              <Spinner className="size-3.5" />
                              Downloading browser runtime…
                            </span>
                          ) : (
                            "Download browser runtime"
                          )}
                        </Button>
                      </div>
                    ) : headerNavBrowserReady ? (
                      <p className="text-xs text-muted">
                        {headerNavBrowserMode === "system"
                          ? `Ready — header nav will launch ${stagehandRuntimeStatus.systemBrowser?.label ?? "your browser"} headlessly.`
                          : "Ready — Playwright Chromium is installed."}
                      </p>
                    ) : null}
                    {stagehandInstallError ? (
                      <p className="text-xs text-amber-800 dark:text-amber-300">
                        {stagehandInstallError}
                      </p>
                    ) : null}
                  </div>
                ) : null}
                {discoverHeaderNav ? (
                  <div className="space-y-2 pt-2">
                    {primaryStartUrl.trim() ? (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <NavPathPill
                          label={
                            headerNavSeed?.label ||
                            headerNavLabel(primaryStartUrl)
                          }
                          selected
                          locked
                          title={`${headerNavSeed?.url || primaryStartUrl} — start URL (always included)`}
                        />
                        {headerNavStatus === "loading" ? (
                          <HeaderNavScanningPill
                            downloading={headerNavDownloading}
                          />
                        ) : null}
                        {headerNavStatus === "ready"
                          ? filterHeaderNavExtraPaths(
                              headerNavPaths,
                              primaryStartUrl,
                            ).map((path) => {
                              const url = normalizeStartUrl(path.url);
                              const selected = additionalStartUrls.some(
                                (item) => normalizeStartUrl(item) === url,
                              );
                              return (
                                <NavPathPill
                                  key={url}
                                  label={path.label}
                                  selected={selected}
                                  title={
                                    selected
                                      ? `${url} — click to drop from this crawl`
                                      : `${url} — click to crawl this section too`
                                  }
                                  onClick={
                                    toolbarLocked
                                      ? undefined
                                      : () => toggleHeaderNavPath(path.url)
                                  }
                                />
                              );
                            })
                          : null}
                        {headerNavStatus === "ready" &&
                        filterHeaderNavExtraPaths(
                          headerNavPaths,
                          primaryStartUrl,
                        ).length === 0 ? (
                          isHeaderNavFailureReason(headerNavReason) ? (
                            <HeaderNavFailedPill reason={headerNavReason!} />
                          ) : (
                            <HeaderNavEmptyPill />
                          )
                        ) : null}
                      </div>
                    ) : (
                      <p className="text-xs text-muted">
                        Add a start URL to scan the header.
                      </p>
                    )}
                    {headerNavStatus === "ready" &&
                    primaryStartUrl.trim() &&
                    filterHeaderNavExtraPaths(headerNavPaths, primaryStartUrl)
                      .length > 0 ? (
                      <p className="text-xs text-muted">
                        {headerNavReason ||
                          "Click a section to crawl it alongside your start URL."}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </div>
              <div className="mt-4 space-y-1 border-t border-border/60 pt-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-foreground">Filter</p>
                    <p className="mt-0.5 text-xs text-muted">
                      After crawl: drop not-found pages and next/previous
                      (legacy, beta, canary…) version trees
                    </p>
                  </div>
                  <Switch
                    checked={autoDiscoverExcludes}
                    onChange={setAutoDiscoverExcludes}
                    label="Filter discovered URLs after crawl"
                    disabled={toolbarLocked}
                  />
                </div>
              </div>
              </div>
            </ConfigPill>

            <ToolbarDivider />

            <ConfigPill
              label="Storage"
              icon={<StorageIcon />}
              compactSummary={
                sourceScope === "global" || !hostingCaps.localAvailable
                  ? "Cloud"
                  : sourceHosting === "local"
                    ? "Local"
                    : "Cloud"
              }
              summary={
                sourceScope === "global" || !hostingCaps.localAvailable
                  ? "Cloud"
                  : sourceHosting === "local"
                    ? "Local"
                    : "Cloud"
              }
              description="Where the docs are processed and kept."
              disabled={toolbarLocked}
            >
              <div className={cn(configPanelInsetClass, "space-y-3")}>
                {sourceScope === "personal" && hostingCaps.localAvailable ? (
                  <>
                    <p className="text-xs leading-5 text-muted">
                      Local keeps everything on this device. Cloud stores it on
                      LedgeIndex servers.
                    </p>
                    <SourceHostingToggle
                      value={sourceHosting}
                      onChange={setSourceHosting}
                      disabled={toolbarLocked || storageSelectionLocked}
                      size="default"
                    />
                    {storageSelectionLocked ? (
                      <p className="text-[0.6875rem] leading-4 text-muted">
                        Locked for this crawl (
                        {sourceHosting === "local" ? "Local" : "Cloud"}). Start
                        a new source to change storage.
                      </p>
                    ) : null}
                  </>
                ) : (
                  <p className="text-xs leading-5 text-muted">
                    {sourceScope === "global"
                      ? "Public sources are always stored in the cloud."
                      : "Cloud storage is used in this environment."}
                  </p>
                )}
              </div>
            </ConfigPill>

            {isAdmin ? (
              <>
                <ToolbarDivider />
                <ConfigPill
                  label="Visibility"
                  icon={<VisibilityIcon />}
                  compactSummary={
                    sourceScope === "global" ? "Public" : "Just me"
                  }
                  summary={sourceScope === "global" ? "Public" : "Just me"}
                  description="Who can see this source."
                  disabled={toolbarLocked}
                >
                  <div className={cn(configPanelInsetClass, "space-y-3")}>
                    <p className="text-xs leading-5 text-muted">
                      Just me keeps it private. Public (admin) publishes it to
                      the shared catalog.
                    </p>
                    <KnowledgeSetScopeToggle
                      value={sourceScope}
                      onChange={handleScopeChange}
                      disabled={toolbarLocked}
                      size="default"
                    />
                  </div>
                </ConfigPill>
              </>
            ) : null}

            <div className="flex shrink-0 items-center px-1">
              <IndexLocationInfo
                hosting={sourceScope === "global" ? "cloud" : sourceHosting}
                scope={sourceScope}
              />
            </div>
            </div>
      </CrawlSettingsToolbarHost>

      {/* ─── Main content ─────────────────────────────────────── */}
      <div
        className={cn(
          "relative z-0 mx-auto flex min-h-0 w-full min-w-0 max-w-[90rem] flex-1 flex-col overflow-hidden",
          step === 2 && "px-4 py-2 sm:px-6 sm:py-3",
        )}
      >
        {step === 1 ? (
          <div className="flex min-h-0 flex-1 flex-col items-center overflow-x-hidden overflow-y-auto overscroll-contain px-4 py-3 sm:px-6 sm:py-4">
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
            discoverHeaderNav={discoverHeaderNav}
            headerNavPaths={headerNavPaths}
            headerNavStatus={headerNavStatus}
            headerNavReason={headerNavReason}
            headerNavScanning={discoverHeaderNav && headerNavStatus === "loading"}
            headerNavDownloading={headerNavDownloading}
            onToggleNavPath={toggleHeaderNavPath}
            onOpenSitemapSelect={() => setSitemapModalOpen(true)}
            onOpenRobotsTxt={() => setRobotsModalOpen(true)}
            onCheckSite={runPreflight}
            busy={busy}
            crawlCardPhase={crawlCardPhase}
            pagesDiscovered={
              crawlCardPhase === "crawling"
                ? liveCrawlCount
                : discoveredUrls.length
            }
            autoExcludePhase={autoExcludePhase}
            autoExcludeResult={autoExcludeResult}
            httpCleanupPhase={httpCleanupPhase}
            httpCleanupResult={httpCleanupResult}
            liveCrawlPhase={liveCrawlPhase}
            liveValidation={liveValidation}
            onSubmit={handleCrawlPreview}
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
                      {httpStatusCount > 0
                        ? ` · ${httpStatusCount} filtered (404/errors)`
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
              {httpStatusCount > 0 ||
              (httpCleanupResult?.filtered ?? 0) > 0 ||
              (autoExcludeResult?.dropped ?? 0) > 0 ? (
                <div className="mb-2 shrink-0 rounded-lg border border-red-500/25 bg-red-500/8 px-3 py-2">
                  <p className="font-mono text-[0.5625rem] font-semibold tracking-[0.08em] text-red-700 uppercase dark:text-red-300">
                    Filtered{" "}
                    {Math.max(
                      httpStatusCount,
                      httpCleanupResult?.filtered ?? 0,
                      autoExcludeResult?.dropped ?? 0,
                    )}{" "}
                    page
                    {Math.max(
                      httpStatusCount,
                      httpCleanupResult?.filtered ?? 0,
                      autoExcludeResult?.dropped ?? 0,
                    ) === 1
                      ? ""
                      : "s"}
                  </p>
                  <p className="mt-0.5 text-[0.6875rem] leading-snug text-muted">
                    {autoExcludeResult?.summary ??
                      "Non-2xx HTTP responses and Filter removals. See skipped list below."}
                  </p>
                </div>
              ) : null}
              {urlPathBreakdown.length > 1 ? (
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {urlPathBreakdown.map((group) => {
                    const segmentState = getPathSegmentSelectionState(
                      discoveredUrls,
                      group.segment,
                      selectedPreviewUrls,
                    );
                    const excludePattern = excludePatternForPathSegment(
                      group.segment,
                    );
                    const isExcluded = linesToList(excludePatternsText).includes(
                      excludePattern,
                    );
                    return (
                    <div
                      key={group.segment}
                      className="inline-flex items-center gap-0.5"
                    >
                    <button
                      type="button"
                      aria-pressed={segmentState !== "none"}
                      onClick={(event) => selectUrlsForPathSegment(group.segment, event)}
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[0.5625rem] font-semibold tracking-[0.06em] uppercase transition-colors",
                        isExcluded
                          ? "border-red-500/35 bg-red-500/10 text-red-700 dark:text-red-300"
                          : segmentState === "all"
                            ? "border-foreground/20 bg-foreground text-background"
                            : segmentState === "partial"
                              ? "border-accent/40 bg-accent/10 text-accent"
                              : "border-border bg-surface-raised text-muted hover:border-foreground/15 hover:text-foreground",
                      )}
                      title={`${group.sampleUrls.join("\n")}\n\nClick to toggle · Alt+click to exclude ${excludePattern}`}
                    >
                      /{group.segment}
                      <span
                        className={
                          segmentState === "all" && !isExcluded
                            ? "opacity-80"
                            : "text-foreground"
                        }
                      >
                        {group.count}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => excludePathSegment(group.segment)}
                      className={cn(
                        "rounded-full border px-1.5 py-0.5 font-mono text-[0.5rem] font-semibold tracking-[0.06em] uppercase transition-colors",
                        isExcluded
                          ? "border-red-500/35 bg-red-500/10 text-red-700 dark:text-red-300"
                          : "border-border bg-surface-raised text-muted hover:border-red-500/35 hover:text-red-700 dark:hover:text-red-300",
                      )}
                      title={`Add exclude pattern ${excludePattern} (kept on future refreshes)`}
                    >
                      Excl
                    </button>
                    </div>
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
                    const excluded = urlMatchesAnyPattern(
                      item.url,
                      linesToList(excludePatternsText),
                      patternsAreRegex,
                    );
                    const pickingExclude = excludePickerUrl === item.url;
                    const pathParts = pickingExclude
                      ? parseUrlPathParts(item.url)
                      : null;
                    const pathTag = showUrlPathTags
                      ? config.startUrls.length > 1
                        ? sourcePathLabelForUrl(item.url, config.startUrls) ??
                          pathSegmentLabelForUrl(item.url)
                        : pathSegmentLabelForUrl(item.url)
                      : null;
                    return (
                      <li key={item.url}>
                        <div
                          className={cn(
                            "group flex w-full items-center gap-2 px-3 py-2 sm:gap-3 sm:px-4",
                            pickingExclude
                              ? "bg-red-500/8 ring-1 ring-inset ring-red-500/25"
                              : excluded
                                ? "bg-red-500/5"
                                : selected
                                  ? "bg-accent-soft"
                                  : "hover:bg-surface-raised",
                          )}
                        >
                          <button
                            type="button"
                            role="checkbox"
                            aria-checked={selected}
                            aria-label={`${selected ? "Deselect" : "Select"} ${item.url}`}
                            disabled={excluded || pickingExclude}
                            onClick={(event) =>
                              handlePreviewUrlClick(index, item.url, event)
                            }
                            className="flex shrink-0 items-center gap-2 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            <span
                              aria-hidden
                              className="w-6 text-right font-mono text-[0.5625rem] tabular-nums text-muted"
                            >
                              {index + 1}
                            </span>
                            <span
                              aria-hidden
                              className={cn(
                                "flex size-4 shrink-0 items-center justify-center rounded-[4px] border-2 transition-colors",
                                selected && !excluded
                                  ? "border-accent bg-accent text-background"
                                  : "border-muted-strong bg-card-solid text-transparent",
                              )}
                            >
                              {selected && !excluded ? (
                                <svg
                                  viewBox="0 0 10 8"
                                  className="size-2.5 fill-none stroke-current stroke-[2.5]"
                                >
                                  <path d="M1 4l2.5 2.5L9 1" />
                                </svg>
                              ) : null}
                            </span>
                          </button>
                          {pathTag ? (
                            <span
                              className="w-[4.75rem] shrink-0 truncate rounded border border-border bg-surface-raised px-1.5 py-0.5 text-center font-mono text-[0.5rem] font-semibold tracking-[0.06em] text-muted uppercase"
                              title={pathTag}
                            >
                              {pathTag}
                            </span>
                          ) : null}
                          {item.httpStatus != null || item.httpErrorReason ? (
                            <span
                              className="shrink-0 rounded-md border border-red-500/30 bg-red-500/10 px-1.5 py-0.5 font-mono text-[0.5rem] font-semibold tracking-[0.06em] text-red-700 uppercase dark:text-red-300"
                              title={
                                item.httpErrorReason ??
                                `HTTP ${item.httpStatus}`
                              }
                            >
                              {item.httpStatus != null
                                ? `HTTP ${item.httpStatus}`
                                : "Error"}
                            </span>
                          ) : null}
                          <div className="min-w-0 flex-1">
                            {item.title && !pickingExclude ? (
                              <p className="truncate text-[0.6875rem] font-medium text-foreground">
                                {item.title}
                              </p>
                            ) : null}
                            {pickingExclude && pathParts ? (
                              <div
                                className="flex flex-wrap items-center gap-y-0.5 font-mono text-[0.6875rem]"
                                onMouseLeave={() => setExcludeHoverIndex(null)}
                              >
                                <span className="text-muted">{pathParts.origin}</span>
                                {pathParts.segments.map((segment, segmentIndex) => {
                                  const highlighted =
                                    excludeHoverIndex != null &&
                                    segmentIndex <= excludeHoverIndex;
                                  return (
                                    <button
                                      key={`${item.url}-${segmentIndex}-${segment}`}
                                      type="button"
                                      onMouseEnter={() =>
                                        setExcludeHoverIndex(segmentIndex)
                                      }
                                      onFocus={() =>
                                        setExcludeHoverIndex(segmentIndex)
                                      }
                                      onClick={() =>
                                        confirmExcludePathPrefix(
                                          item.url,
                                          segmentIndex,
                                        )
                                      }
                                      className={cn(
                                        "rounded-sm px-0.5 transition-colors",
                                        highlighted
                                          ? "bg-red-500/20 text-red-700 dark:text-red-300"
                                          : "text-muted-strong hover:bg-red-500/10 hover:text-red-700 dark:hover:text-red-300",
                                      )}
                                      title={`Exclude ${excludePatternFromPathPrefix(pathParts.segments, segmentIndex)}`}
                                    >
                                      /{segment}
                                    </button>
                                  );
                                })}
                                <span className="ml-2 font-mono text-[0.5625rem] text-red-700 dark:text-red-300">
                                  {excludeHoverIndex == null
                                    ? "Hover a path · click to exclude"
                                    : `Exclude ${excludePatternFromPathPrefix(pathParts.segments, excludeHoverIndex)}`}
                                </span>
                              </div>
                            ) : (
                              <a
                                href={item.url}
                                target="_blank"
                                rel="noreferrer"
                                className={cn(
                                  "block truncate font-mono text-[0.6875rem] hover:underline",
                                  excluded
                                    ? "text-muted line-through"
                                    : item.title
                                      ? "text-muted"
                                      : "text-muted-strong",
                                )}
                                title={item.url}
                                onClick={(event) => event.stopPropagation()}
                              >
                                {item.url}
                              </a>
                            )}
                          </div>
                          {excluded ? (
                            <span className="shrink-0 rounded border border-red-500/30 bg-red-500/10 px-1.5 py-0.5 font-mono text-[0.5rem] font-semibold tracking-[0.06em] text-red-700 uppercase dark:text-red-300">
                              Excluded
                            </span>
                          ) : (
                            <div
                              className={cn(
                                "flex shrink-0 items-center gap-1 transition-opacity",
                                pickingExclude
                                  ? "opacity-100"
                                  : "opacity-0 group-focus-within:opacity-100 group-hover:opacity-100",
                              )}
                            >
                              {pickingExclude ? (
                                <button
                                  type="button"
                                  onClick={cancelExcludePicker}
                                  className="rounded-md border border-border bg-surface-raised px-1.5 py-0.5 font-mono text-[0.5rem] font-semibold tracking-[0.06em] text-muted uppercase transition-colors hover:text-foreground"
                                >
                                  Cancel
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => startExcludePicker(item.url)}
                                  className="rounded-md border border-red-500/35 bg-red-500/10 px-1.5 py-0.5 font-mono text-[0.5rem] font-semibold tracking-[0.06em] text-red-700 uppercase transition-colors hover:bg-red-500/15 dark:text-red-300"
                                  title="Pick which path to exclude"
                                >
                                  Exclude
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => void copySingleUrl(item.url)}
                                className={cn(
                                  "inline-flex size-7 items-center justify-center rounded-md border transition-colors",
                                  copiedUrl === item.url
                                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                                    : "border-border bg-surface-raised text-muted hover:text-foreground",
                                )}
                                title="Copy URL"
                                aria-label={`Copy ${item.url}`}
                              >
                                <Copy className="size-3" aria-hidden />
                              </button>
                            </div>
                          )}
                        </div>
                      </li>
                    );
                  })
                )}
              </ul>

              {skippedUrls.length > 0 ? (
                <details
                  className="group mt-3"
                  open={
                    discoveredUrls.length === 0 || httpStatusCount > 0
                  }
                >
                  <summary className="flex cursor-pointer list-none items-center gap-2 text-[0.6875rem] text-muted transition-colors hover:text-foreground [&::-webkit-details-marker]:hidden">
                    <span
                      aria-hidden
                      className="inline-block transition-transform group-open:rotate-90"
                    >
                      ▸
                    </span>
                    {skippedUrls.length} URLs skipped
                    {httpStatusCount > 0
                      ? ` · ${httpStatusCount} filtered errors`
                      : ""}
                    {canonicalAliasCount > 0
                      ? ` · ${canonicalAliasCount} aliases`
                      : ""}
                  </summary>
                  <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto rounded-xl border border-border bg-background p-2">
                    {skippedUrls.slice(0, 100).map((item, index) => (
                      <li
                        key={`${index}-${item.url}-${item.reason}`}
                        className="flex items-baseline gap-2 text-[0.6875rem]"
                      >
                        <span
                          className={cn(
                            "shrink-0 rounded-md border px-1.5 py-0.5 font-mono text-[0.5rem] uppercase",
                            isHttpStatusSkipReason(item.reason)
                              ? "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300"
                              : "border-border bg-surface-raised text-muted",
                          )}
                        >
                          {item.reason}
                        </span>
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="min-w-0 truncate font-mono text-muted underline-offset-2 hover:text-foreground hover:underline"
                          title={item.url}
                        >
                          {item.url}
                        </a>
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
            activeStepId={
              filterPipelinePhase === "http" ||
              filterPipelinePhase === "auto-exclude"
                ? "filter"
                : step === 1
                  ? "crawl"
                  : "extract"
            }
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
      <SitemapSelectModal
        open={sitemapModalOpen}
        candidates={
          discoverySignals?.sitemap.candidates?.length
            ? discoverySignals.sitemap.candidates
            : discoverySignals?.sitemap.found
              ? [
                  {
                    url: discoverySignals.sitemap.url,
                    reachable: true,
                  },
                ]
              : []
        }
        selectedUrls={linesToList(sitemapUrlsText).map(normalizeStartUrl)}
        primarySitemapUrl={
          discoverySignals?.sitemap.found
            ? discoverySignals.sitemap.url
            : null
        }
        onCancel={() => setSitemapModalOpen(false)}
        onApply={(urls) => {
          setSitemapUrlsText(urls.join("\n"));
          if (urls.length > 0) setEnableSitemap(true);
          setSitemapModalOpen(false);
          setIndexEstimate(null);
          // Refresh page count for the chosen set.
          void runPreflight();
        }}
      />
      <RobotsTxtModal
        open={robotsModalOpen}
        startUrl={primaryStartUrl}
        robotsUrl={
          discoverySignals?.robots.found
            ? discoverySignals.robots.url
            : null
        }
        onClose={() => setRobotsModalOpen(false)}
      />
      {agentGuideSourceId ? (
        <AgentGuideReviewDialog
          open
          sourceId={agentGuideSourceId}
          onComplete={() => {
            const completedSourceId = agentGuideSourceId;
            setAgentGuideSourceId(null);
            router.push(
              dashboardIndexRedirectUrl(completedSourceId, sourceScope),
            );
          }}
        />
      ) : null}
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

function headerNavLabel(url: string) {
  try {
    const parsed = new URL(normalizeStartUrl(url));
    const parts = parsed.pathname.split("/").filter(Boolean);
    const last = parts[parts.length - 1];
    if (!last) return parsed.hostname.replace(/^www\./, "") || "Start";
    return last
      .split(/[-_]/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
      .join(" ");
  } catch {
    return url;
  }
}

function filterHeaderNavExtraPaths(
  paths: HeaderNavPath[],
  primaryStartUrl: string,
): HeaderNavPath[] {
  const primary = normalizeStartUrl(primaryStartUrl.trim());
  if (!primary) return [];
  const seen = new Set<string>();
  return paths.filter((path) => {
    const url = normalizeStartUrl(path.url);
    if (!url || url === primary || seen.has(url)) return false;
    seen.add(url);
    return true;
  });
}

function HeaderNavScanningPill({
  compact = false,
  downloading = false,
}: {
  compact?: boolean;
  downloading?: boolean;
}) {
  const label = downloading
    ? "Downloading browser runtime…"
    : "Scanning header nav…";
  return (
    <span
      title={
        downloading
          ? "One-time download (~150 MB). Later scans skip this step."
          : "Reading the site header for sibling docs sections."
      }
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-md border border-accent/30 bg-accent/10 font-mono font-semibold tracking-[0.08em] text-accent uppercase",
        compact
          ? "px-2 py-0.5 text-[0.5rem]"
          : "px-2.5 py-1 text-[0.5625rem]",
      )}
      aria-live="polite"
    >
      <Spinner className={compact ? "size-3" : "size-3.5"} />
      {label}
    </span>
  );
}

function HeaderNavEmptyPill({ compact = false }: { compact?: boolean }) {
  return (
    <span
      title="Checked the site header — no extra docs sections besides your start URL"
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border bg-surface-raised font-mono font-semibold tracking-[0.08em] text-muted/70 uppercase",
        compact
          ? "px-2 py-0.5 text-[0.5rem]"
          : "px-2.5 py-1 text-[0.5625rem]",
      )}
    >
      <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-muted/35" />
      No additional paths
    </span>
  );
}

function HeaderNavFailedPill({
  reason,
  compact = false,
}: {
  reason: string;
  compact?: boolean;
}) {
  return (
    <span
      title={reason}
      className={cn(
        "inline-flex shrink-0 max-w-[14rem] items-center gap-1.5 truncate rounded-md border border-amber-500/30 bg-amber-500/10 font-mono font-semibold tracking-[0.08em] text-amber-800 uppercase dark:text-amber-300",
        compact
          ? "px-2 py-0.5 text-[0.5rem]"
          : "px-2.5 py-1 text-[0.5625rem]",
      )}
    >
      <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-amber-500" />
      Nav scan failed
    </span>
  );
}

function isHeaderNavFailureReason(reason: string | null | undefined): boolean {
  if (!reason) return false;
  return /timed out|failed|error|not installed|missing|uncaught/i.test(reason);
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
    <div className="flex min-w-0 shrink-0 items-center gap-2 border-b border-border bg-surface-raised px-3 py-2 sm:gap-3 sm:px-4">
      <div className="flex min-w-0 shrink-0 items-center gap-2">
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
        <div className="flex shrink-0 items-center">{leadingAside}</div>
      ) : null}
      {centerAside ? (
        <div className="flex min-w-0 flex-1 items-center justify-center overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {centerAside}
        </div>
      ) : (
        <div className="min-w-0 flex-1" />
      )}
      {aside ? (
        <div className="flex min-w-0 max-w-[55%] shrink-0 items-center justify-end gap-1.5 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:max-w-[50%]">
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

      <NewSourceFirstHint hasUrl={hasUrl} />

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
  discoverHeaderNav = false,
  headerNavPaths = [],
  headerNavStatus = "idle",
  headerNavReason = null,
  headerNavScanning = false,
  headerNavDownloading = false,
  onToggleNavPath,
  onOpenSitemapSelect,
  onOpenRobotsTxt,
  onCheckSite,
  busy,
  crawlCardPhase,
  pagesDiscovered,
  autoExcludePhase,
  autoExcludeResult,
  httpCleanupPhase,
  httpCleanupResult,
  liveCrawlPhase,
  liveValidation,
  onSubmit,
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
  discoverHeaderNav?: boolean;
  headerNavPaths?: HeaderNavPath[];
  headerNavStatus?: "idle" | "loading" | "ready" | "error";
  headerNavReason?: string | null;
  headerNavScanning?: boolean;
  headerNavDownloading?: boolean;
  onToggleNavPath?: (url: string) => void;
  onOpenSitemapSelect?: () => void;
  onOpenRobotsTxt?: () => void;
  onCheckSite: (url?: string) => void;
  busy: string | null;
  crawlCardPhase: CrawlCardPhase;
  pagesDiscovered: number;
  autoExcludePhase: "idle" | "analysing" | "done";
  autoExcludeResult: {
    scanned: number;
    added: number;
    dropped: number;
    summary?: string;
  } | null;
  httpCleanupPhase: "idle" | "cleaning" | "done";
  httpCleanupResult: { filtered: number; keptInList?: boolean } | null;
  liveCrawlPhase: "discovering" | "validating";
  liveValidation: { done: number; total: number; errors: number } | null;
  onSubmit: () => void;
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
    preflightState === "ok" &&
    sameStartUrlForBranding(normalizedUrl, preflightCheckedUrl);
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
    ? liveCrawlPhase === "validating"
      ? liveValidation && liveValidation.total > 0
        ? `Checking HTTP · ${liveValidation.done} / ${liveValidation.total}`
        : "Dropping error pages…"
      : pagesDiscovered > 0
        ? `Finding pages · ${pagesDiscovered} / ${maxPages}`
        : "Finding pages in your docs"
    : isCrawlComplete
      ? `${pagesDiscovered} page${pagesDiscovered === 1 ? "" : "s"} ready`
      : preflightState === "loading"
        ? "Checking your docs"
        : showSitePreview
          ? detectedName
          : "Add docs from a URL";

  const showDiscoveryFooter =
    preflightState === "loading" || discoverySignals != null;
  const displaySignals = sourceMetadata
    ? getDisplayDetectedSignals(sourceMetadata)
    : [];
  const showMetadataFooter = showSitePreview && sourceMetadata != null;
  const headerNavExtraPaths = filterHeaderNavExtraPaths(
    headerNavPaths,
    primaryStartUrl,
  );
  const showFooter =
    isCrawling ||
    isCrawlComplete ||
    showDiscoveryFooter ||
    showMetadataFooter ||
    discoverHeaderNav;

  return (
    <section
      className={cn(
        "relative mx-auto my-auto flex w-full min-h-0 shrink-0 flex-col overflow-hidden rounded-xl border border-border bg-card-solid shadow-card transition-[max-width,box-shadow] duration-500 ease-out",
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
          <div className="flex items-center gap-2">
            {httpCleanupPhase === "cleaning" ||
            (isCrawling && liveCrawlPhase === "validating") ? (
              <span className="inline-flex max-w-[11rem] items-center gap-1.5 font-mono text-[0.5rem] font-semibold tracking-[0.08em] text-accent uppercase sm:max-w-none">
                <Spinner className="size-3" />
                Dropping error pages…
              </span>
            ) : null}
            {httpCleanupPhase === "done" &&
            httpCleanupResult &&
            autoExcludePhase === "idle" ? (
              <span className="hidden max-w-[11rem] truncate font-mono text-[0.5rem] font-semibold tracking-[0.08em] text-emerald-700 uppercase sm:inline dark:text-emerald-400">
                {httpCleanupResult.keptInList
                  ? `${httpCleanupResult.filtered} errors marked`
                  : `−${httpCleanupResult.filtered} error pages`}
              </span>
            ) : null}
            {autoExcludePhase === "analysing" ? (
              <span className="inline-flex max-w-[10rem] items-center gap-1.5 font-mono text-[0.5rem] font-semibold tracking-[0.08em] text-accent uppercase sm:max-w-none">
                <Spinner className="size-3" />
                Filtering…
              </span>
            ) : null}
            {autoExcludePhase === "done" && autoExcludeResult ? (
              <span
                className="hidden max-w-[12rem] truncate font-mono text-[0.5rem] font-semibold tracking-[0.08em] text-emerald-700 uppercase sm:inline dark:text-emerald-400"
                title={`Scanned ${autoExcludeResult.scanned} links`}
              >
                +{autoExcludeResult.added} filters · −{autoExcludeResult.dropped} urls
              </span>
            ) : null}
            {busy === "crawl" &&
            autoExcludePhase === "idle" &&
            httpCleanupPhase === "idle" &&
            liveCrawlPhase !== "validating" ? (
              <button
                type="button"
                onClick={onAbortCrawl}
                className="inline-flex h-7 shrink-0 items-center rounded-md border border-border bg-card-solid px-2.5 font-mono text-[0.5rem] font-semibold tracking-[0.08em] text-muted uppercase transition-colors hover:text-foreground"
              >
                Stop
              </button>
            ) : crawlCardPhase === "idle" ? (
              <button
                type="button"
                onClick={onSubmit}
                disabled={
                  Boolean(busy) ||
                  crawlCardPhase !== "idle" ||
                  headerNavScanning
                }
                title={
                  headerNavScanning
                    ? "Wait for header nav scan to finish"
                    : undefined
                }
                className="inline-flex h-7 shrink-0 items-center rounded-md border border-foreground/15 bg-foreground px-2.5 font-mono text-[0.5rem] font-semibold tracking-[0.08em] text-background uppercase transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Crawl{crawlStartUrlCount > 1 ? ` ${crawlStartUrlCount}` : ""}
              </button>
            ) : null}
          </div>
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

              {isCrawling ||
              httpCleanupPhase === "cleaning" ||
              autoExcludePhase === "analysing" ? (
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
                    phase={
                      autoExcludePhase === "analysing"
                        ? "auto-exclude"
                        : liveCrawlPhase === "validating" ||
                            httpCleanupPhase === "cleaning"
                          ? "validating"
                          : "discovering"
                    }
                    validation={liveValidation}
                    httpCleanupResult={httpCleanupResult}
                  />
                </div>
              ) : null}

              {isCrawlComplete &&
              httpCleanupPhase !== "cleaning" &&
              autoExcludePhase !== "analysing" ? (
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
            {isCrawling ||
            httpCleanupPhase === "cleaning" ||
            autoExcludePhase === "analysing" ? (
              <CrawlInProgressPanel
                displayUrl={displayUrl}
                maxPages={maxPages}
                pagesDiscovered={pagesDiscovered}
                enableSitemap={enableSitemap}
                robotsFound={discoverySignals?.robots.found}
                sitemapFound={discoverySignals?.sitemap.found}
                phase={
                  autoExcludePhase === "analysing"
                    ? "auto-exclude"
                    : liveCrawlPhase === "validating" ||
                        httpCleanupPhase === "cleaning"
                      ? "validating"
                      : "discovering"
                }
                validation={liveValidation}
                httpCleanupResult={httpCleanupResult}
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
        ) : null}
        {showDiscoveryFooter ? (
          <>
            {isCrawlComplete ? (
              <span className="mx-0.5 hidden h-3 w-px bg-border sm:inline" aria-hidden />
            ) : null}
            <DiscoverySignalPill
              label="Robots"
              found={discoverySignals?.robots.found ?? null}
              loading={preflightState === "loading"}
              title={
                discoverySignals?.robots.found
                  ? `${discoverySignals.robots.url}${discoverySignals.robots.disallowRules != null ? ` · ${discoverySignals.robots.disallowRules} disallow rule(s)` : ""} — click to view`
                  : discoverySignals
                    ? `${discoverySignals.robots.url} not found — click to retry`
                    : "Checking robots.txt…"
              }
              onClick={
                preflightState === "loading" || Boolean(busy)
                  ? undefined
                  : onOpenRobotsTxt
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
                  ? `${discoverySignals.sitemap.url}${discoverySignals.sitemap.pageCount != null ? ` · ${discoverySignals.sitemap.pageCount} pages in scope` : ""} — click to choose sitemaps`
                  : discoverySignals
                    ? "No sitemap.xml discovered at common paths — click to add or choose"
                    : "Checking sitemap…"
              }
              onClick={
                preflightState === "loading" || Boolean(busy)
                  ? undefined
                  : onOpenSitemapSelect
              }
            />
          </>
        ) : null}
        </div>
        {discoverHeaderNav && hasUrl ? (
          <div
            className="flex min-w-0 flex-wrap items-center justify-end gap-1.5"
            aria-live="polite"
            aria-busy={headerNavStatus === "loading"}
          >
            {headerNavStatus === "loading" ? (
              <HeaderNavScanningPill
                compact
                downloading={headerNavDownloading}
              />
            ) : headerNavStatus === "ready" ? (
              headerNavExtraPaths.length > 0 ? (
                headerNavExtraPaths.map((path) => {
                  const url = normalizeStartUrl(path.url);
                  const selected = additionalStartUrls.some(
                    (item) => normalizeStartUrl(item) === url,
                  );
                  return (
                    <NavPathPill
                      key={url}
                      label={path.label}
                      selected={selected}
                      title={
                        selected
                          ? `${url} — click to drop from this crawl`
                          : `${url} — click to add this section`
                      }
                      onClick={
                        preflightState === "loading" || Boolean(busy)
                          ? undefined
                          : () => onToggleNavPath?.(path.url)
                      }
                    />
                  );
                })
              ) : (
                isHeaderNavFailureReason(headerNavReason) ? (
                  <HeaderNavFailedPill reason={headerNavReason!} compact />
                ) : (
                  <HeaderNavEmptyPill compact />
                )
              )
            ) : null}
          </div>
        ) : null}
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
  phase = "discovering",
  validation = null,
  httpCleanupResult = null,
}: {
  displayUrl: string;
  maxPages: number;
  pagesDiscovered: number;
  enableSitemap: boolean;
  robotsFound?: boolean;
  sitemapFound?: boolean;
  phase?: "discovering" | "validating" | "auto-exclude";
  validation?: { done: number; total: number; errors: number } | null;
  httpCleanupResult?: { filtered: number; keptInList?: boolean } | null;
}) {
  const isFiltering = phase === "validating" || phase === "auto-exclude";

  const steps =
    phase === "auto-exclude"
      ? [
          "HTTP error cleanup finished",
          "Scanning remaining URLs for version trees",
          "Suggesting excludes for versions, blog, changelog…",
          httpCleanupResult
            ? httpCleanupResult.keptInList
              ? `Marked ${httpCleanupResult.filtered} non-2xx page${httpCleanupResult.filtered === 1 ? "" : "s"} in the list`
              : `Removed ${httpCleanupResult.filtered} non-2xx page${httpCleanupResult.filtered === 1 ? "" : "s"}`
            : "Keeping only successful pages",
        ]
      : phase === "validating"
        ? [
            `${pagesDiscovered} pages discovered on ${displayUrl}`,
            validation && validation.total > 0
              ? `Checking HTTP status ${validation.done} / ${validation.total}`
              : "Probing page status (only 2xx stays)",
            "Dropping 404, 429, 5xx, and network failures",
            "Then Filter (AI) runs if that toggle is on",
          ]
        : [
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
            {phase === "auto-exclude"
              ? "Filter (AI)"
              : phase === "validating"
                ? "Filtering error pages"
                : "Crawl in progress"}
          </p>
          <p className="mt-0.5 text-[0.6875rem] leading-5 text-muted">
            {phase === "auto-exclude"
              ? "AI dropping not-found pages and next/previous version trees…"
              : phase === "validating"
                ? validation && validation.total > 0
                  ? `Checking HTTP ${validation.done} / ${validation.total}…`
                  : "Dropping non-2xx pages…"
                : pagesDiscovered > 0
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
              className={cn(
                "size-1 shrink-0 rounded-full",
                isFiltering ? "animate-pulse bg-accent" : "animate-pulse bg-accent",
              )}
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

function StorageIcon() {
  return (
    <svg viewBox="0 0 20 20" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <rect x="3.5" y="4" width="13" height="4" rx="1" />
      <rect x="3.5" y="12" width="13" height="4" rx="1" />
      <path d="M6.5 6h.01M6.5 14h.01" strokeLinecap="round" />
    </svg>
  );
}

function VisibilityIcon() {
  return (
    <svg viewBox="0 0 20 20" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <path d="M2.5 10s2.75-4.5 7.5-4.5S17.5 10 17.5 10s-2.75 4.5-7.5 4.5S2.5 10 2.5 10z" />
      <circle cx="10" cy="10" r="2" />
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

function NavPathPill({
  label,
  selected,
  title,
  onClick,
  locked = false,
}: {
  label: string;
  selected: boolean;
  title?: string;
  onClick?: () => void;
  locked?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={!onClick || locked}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-0.5 font-mono text-[0.5rem] font-semibold tracking-[0.08em] uppercase transition-colors",
        selected
          ? "border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
          : "border-border bg-card-solid text-muted",
        onClick && !locked && "cursor-pointer hover:border-foreground/25 hover:text-foreground",
        (!onClick || locked) && "cursor-default",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          selected ? "bg-emerald-500" : "bg-muted/50",
        )}
      />
      {label}
    </button>
  );
}

function DiscoverySignalPill({
  label,
  found,
  loading,
  title,
  onClick,
}: {
  label: string;
  found: boolean | null;
  loading?: boolean;
  title?: string;
  onClick?: () => void;
}) {
  const className = cn(
    "inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-0.5 font-mono text-[0.5rem] font-semibold tracking-[0.08em] uppercase transition-colors",
    loading && "border-border bg-surface-raised text-muted",
    !loading &&
      found === true &&
      "border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    !loading && found === false && "border-border bg-surface-raised text-muted/45",
    onClick &&
      !loading &&
      "cursor-pointer hover:border-foreground/25 hover:text-foreground",
  );

  const content = (
    <>
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
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        title={title}
        onClick={onClick}
        disabled={loading}
        className={className}
      >
        {content}
      </button>
    );
  }

  return (
    <span title={title} className={className}>
      {content}
    </span>
  );
}

function CrawlSettingsToolbarHost({
  desktop,
  children,
}: {
  desktop: boolean;
  children: ReactNode;
}) {
  useLayoutEffect(() => {
    if (!desktop) {
      setWebCrawlHeaderControls(null);
      return;
    }
    setWebCrawlHeaderControls(children);
  }, [desktop, children]);

  useLayoutEffect(() => {
    return () => setWebCrawlHeaderControls(null);
  }, []);

  if (desktop) return null;

  return (
    <div className="relative z-30 shrink-0 border-b border-border/40 bg-background/90 px-3 py-2 backdrop-blur-sm sm:px-6 sm:py-2.5">
      <div className="mx-auto w-full min-w-0 max-w-[90rem]">
        <div className="relative flex min-w-0 items-center justify-center">
          <div className="absolute left-0 top-1/2 z-10 -translate-y-1/2">
            <MobileMenuButton />
          </div>
          <div className="flex min-w-0 max-w-full items-center justify-center overflow-x-auto px-11 [-ms-overflow-style:none] [scrollbar-width:none] sm:px-12 [&::-webkit-scrollbar]:hidden">
            {children}
          </div>
        </div>
      </div>
    </div>
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
  emphasized = false,
}: {
  label: string;
  summary: ReactNode;
  compactSummary?: ReactNode;
  description?: string;
  icon?: ReactNode;
  children: ReactNode;
  disabled?: boolean;
  emphasized?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [panelRect, setPanelRect] = useState<{
    top: number;
    left: number;
    width: number;
    maxHeight: number;
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
    const top = rect.bottom + 8;
    const maxHeight = Math.max(160, window.innerHeight - top - 12);

    setPanelRect({
      top,
      left,
      width,
      maxHeight,
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
              maxHeight: panelRect.maxHeight,
              zIndex: 200,
            }}
            className={cn(
              "animate-crawl-panel-enter flex flex-col",
              configPanelShellClass,
            )}
          >
            <div className="flex shrink-0 items-start gap-2.5 border-b border-border bg-surface-raised px-3 py-2.5 sm:px-4">
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
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 sm:p-4">
              {children}
            </div>
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
          emphasized &&
            !open &&
            "border-accent/35 bg-accent/10 text-foreground shadow-card animate-pulse",
          open
            ? "border-border bg-card-solid text-foreground shadow-card"
            : !emphasized &&
                "text-muted-strong hover:border-border/60 hover:bg-card-solid/80 hover:text-foreground",
          emphasized && open && "border-accent/40 bg-card-solid text-foreground shadow-card",
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
          <a
            href={page.url}
            target="_blank"
            rel="noreferrer"
            className="hover:text-foreground hover:underline"
          >
            {page.url}
          </a>
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
