import type {
  SourceMetadata,
  DocsIdentity,
  DocsIdentityPath,
  DocsIdentityKind,
  DocsIdentityLanguage,
  SiteProfile,
} from "./source-metadata";

type ApiUrlEnv = {
  NEXT_PUBLIC_LEDGEINDEX_API_URL?: string;
  NEXT_PUBLIC_KNOWLEDGEINDEX_API_URL?: string;
};

export function resolveApiBaseUrl(env?: ApiUrlEnv): string {
  // Prefer an explicit env bag (tests). Otherwise read NEXT_PUBLIC_* directly so
  // Next.js / bundlers can inline them — never `const e = process.env; e.FOO`.
  const ledge =
    env?.NEXT_PUBLIC_LEDGEINDEX_API_URL ??
    (typeof process !== "undefined"
      ? process.env.NEXT_PUBLIC_LEDGEINDEX_API_URL
      : undefined);
  const legacy =
    env?.NEXT_PUBLIC_KNOWLEDGEINDEX_API_URL ??
    (typeof process !== "undefined"
      ? process.env.NEXT_PUBLIC_KNOWLEDGEINDEX_API_URL
      : undefined);
  return ledge?.trim() || legacy?.trim() || "http://localhost:3010";
}

/** Lazily resolved so Next can inline NEXT_PUBLIC_* at app build time. */
let apiBaseUrl: string | null = null;

export function getLedgeIndexApiBaseUrl(): string {
  if (!apiBaseUrl) {
    apiBaseUrl = resolveApiBaseUrl().replace(/\/$/, "");
  }
  return apiBaseUrl;
}

export function setLedgeIndexApiBaseUrl(url: string): void {
  const trimmed = url.trim().replace(/\/$/, "");
  apiBaseUrl = trimmed || resolveApiBaseUrl().replace(/\/$/, "");
}

const getApiBase = () => getLedgeIndexApiBaseUrl();

export type {
  SourceMetadata,
  DocsIdentity,
  DocsIdentityPath,
  DocsIdentityKind,
  DocsIdentityLanguage,
  SiteProfile,
};

export type WebCrawlConfig = {
  startUrls: string[];
  includePatterns: string[];
  excludePatterns: string[];
  excludeDownloadPatterns: string[];
  patternsAreRegex: boolean;
  renderJs: boolean;
  useProxy: boolean;
  enableSitemap: boolean;
  sitemapOnly?: boolean;
  sitemapUrls: string[];
  fileTypes: ("html" | "pdf")[];
  contentSelectors: string[];
  excludeSelectors: string[];
  maxPages: number;
  userAgent: string;
};

export type SourceScope = "personal" | "global";

/** Where the index lives — independent of personal vs public visibility. */
export type SourceHosting = "local" | "cloud";

export type Source = {
  id: string;
  projectId: string;
  name: string;
  slug: string;
  type: "web_crawl";
  scope?: SourceScope;
  hosting?: SourceHosting;
  config: WebCrawlConfig;
  ogImageUrl?: string | null;
  faviconUrl?: string | null;
  sourceMetadata?: SourceMetadata | null;
  indexedAt?: string | null;
  indexStats?: {
    pageCount: number;
    chunkCount: number;
    vectorBackend?: string;
  } | null;
  canonicalUrl?: string | null;
  sourceFamilyId?: string | null;
  versionNumber?: number;
  versionLabel?: string | null;
  categories?: string[];
  /** Admin catalog order (lower first). Null = unsorted fallback. */
  displayOrder?: number | null;
};

export type SourceCategoryOption = {
  slug: string;
  label: string;
  count: number;
};

export type SourceVersionSummary = {
  id: string;
  versionNumber: number;
  versionLabel: string;
  indexedAt: string | null;
  chunkCount: number;
  pageCount: number;
};

export type SourceSummary = {
  id: string;
  projectId: string;
  name: string;
  slug: string;
  scope: SourceScope;
  hosting?: SourceHosting;
  startUrl: string;
  /** All crawl roots for this set (startUrl is the first). */
  startUrls: string[];
  ogImageUrl: string | null;
  faviconUrl: string | null;
  indexedAt: string | null;
  pageCount: number;
  chunkCount: number;
  canonicalUrl: string | null;
  sourceFamilyId: string;
  versionNumber: number;
  versionLabel: string;
  versions: SourceVersionSummary[];
  categories: string[];
  /** Admin catalog order (lower first). Null = unsorted fallback. */
  displayOrder?: number | null;
  /** Crawl URL exclude patterns saved on the source (applied on refresh). */
  excludePatterns?: string[];
  /** Crawl URL include patterns saved on the source. */
  includePatterns?: string[];
  /** True when a multi-lens site profile is saved on the source. */
  hasSiteProfile?: boolean;
  /** Lens count on the saved site profile (0 when none). */
  siteProfileLensCount?: number;
};

export type SourceDuplicateMatch = {
  canonicalUrl: string;
  existing: SourceSummary;
  versions: SourceVersionSummary[];
  suggestedVersionNumber: number;
  suggestedVersionLabel: string;
};

export type SourceAskResult = {
  mode: "agent" | "retrieve-only";
  answer: string;
  chunks: Array<{
    text: string;
    url: string;
    title: string;
    score: number;
  }>;
  insufficient: boolean;
  rerankBackend?: "cohere" | "local" | "vector" | "llm-batch" | "cohere-mastra";
};

export type DocsAskRerankBackend = "cohere" | "local" | "vector";

export type DocsAskModelSelection = {
  backend: string;
  modelId?: string;
  baseUrl?: string;
  googleModelId?: string;
};

export type CrawlRun = {
  id: string;
  sourceId: string;
  kind: string;
  status: string;
  pagesDiscovered: number;
  result?: {
    urls?: { url: string; title?: string }[];
    skipped?: { url: string; reason: string }[];
  };
  error?: string | null;
};

export type ParsePreviewPage = {
  url: string;
  title: string;
  markdown: string;
  charCount?: number;
  estimatedChunks?: number;
  error?: string;
};

export type IndexSizePageEstimate = {
  url: string;
  title: string;
  charCount: number;
  estimatedChunks: number;
  error?: string;
};

export type IndexSizeEstimate = {
  pages: IndexSizePageEstimate[];
  parsedCount: number;
  failedCount: number;
  totalEstimatedChunks: number;
  avgChunksPerPage: number;
  selectedUrlCount: number;
  extrapolatedTotalChunks: number | null;
};

export type PipelineNodeStatus =
  | "pending"
  | "running"
  | "done"
  | "suspended"
  | "error";

export type IngestPipelineNode = {
  id: "crawl" | "filter" | "extract" | "embed" | "store" | "profile";
  label: string;
  status: PipelineNodeStatus;
  detail?: string;
  progress?: {
    current: number;
    total: number;
    phase?: string;
  };
};

export type IngestPipelineSnapshot = {
  runId: string;
  status: string;
  /** False when crawl review disabled example enrichment. */
  enrichExamples?: boolean;
  suspendedStep?: string;
  suspendPayload?: unknown;
  /** Pages enriched so far while enrich step is still running. */
  liveEnrichPages?: unknown[];
  liveEnrichCount?: number;
  livePhase?: "extracting" | "enriching" | "chunking" | "embedding" | "storing";
  liveProgress?: {
    current: number;
    total: number;
    sectionCurrent?: number;
    sectionTotal?: number;
    sectionUrl?: string;
  };
  result?: {
    sourceId: string;
    chunkCount: number;
    pageCount: number;
    catalogUpdatedAt?: string;
  };
  error?: string;
  pipeline: IngestPipelineNode[];
};

export class KnowledgeIndexApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "KnowledgeIndexApiError";
    this.status = status;
  }
}

function formatApiErrorPayload(error: unknown, data?: unknown): string {
  if (typeof error === "string") {
    // Fastify default: { error: "Internal Server Error", message: "…" }
    if (
      (/^internal server error$/i.test(error) ||
        /^service unavailable$/i.test(error)) &&
      data &&
      typeof data === "object" &&
      "message" in data &&
      typeof (data as { message?: unknown }).message === "string"
    ) {
      return (data as { message: string }).message;
    }
    return error;
  }
  if (!error || typeof error !== "object") {
    if (
      data &&
      typeof data === "object" &&
      "message" in data &&
      typeof (data as { message?: unknown }).message === "string"
    ) {
      return (data as { message: string }).message;
    }
    return "Request failed";
  }

  if ("message" in error && typeof error.message === "string") {
    return error.message;
  }

  const flattened = error as {
    formErrors?: string[];
    fieldErrors?: Record<string, string[] | undefined>;
  };

  const parts = [
    ...(flattened.formErrors ?? []),
    ...Object.entries(flattened.fieldErrors ?? {}).flatMap(([field, messages]) =>
      (messages ?? []).map((message) => `${field}: ${message}`),
    ),
  ];

  return parts.join("; ") || "Request failed";
}

/** @deprecated Use KnowledgeIndexApiError */
export const LedgeIndexApiError = KnowledgeIndexApiError;

let authTokenGetter: ((forceRefresh?: boolean) => Promise<string | null>) | null =
  null;

export function setApiAuthTokenGetter(
  getter: ((forceRefresh?: boolean) => Promise<string | null>) | null,
) {
  authTokenGetter = getter;
}

async function resolveAuthToken(forceRefresh = false): Promise<string | null> {
  if (authTokenGetter) {
    const token = await authTokenGetter(forceRefresh);
    if (token) return token;
  }
  return null;
}

/** Fetch wrapper that attaches Firebase auth (for AI SDK streaming chat). */
export async function authenticatedFetch(
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> {
  async function doFetch(forceRefresh: boolean): Promise<Response> {
    const headers = new Headers(init?.headers);
    const hasBody = init?.body != null && init.body !== "";

    if (hasBody && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    if (!headers.has("Authorization")) {
      const token = await resolveAuthToken(forceRefresh);
      if (token) {
        headers.set("Authorization", `Bearer ${token}`);
      }
    }

    return fetch(input, { ...init, headers });
  }

  const response = await doFetch(false);
  if (response.status !== 401) {
    return response;
  }

  const refreshed = await resolveAuthToken(true);
  if (!refreshed) {
    return response;
  }

  return doFetch(true);
}

async function fetchWithAuth(
  path: string,
  init: RequestInit | undefined,
  options?: { notFoundAsNull?: boolean; retried?: boolean },
): Promise<{ response: Response; data: unknown }> {
  const hasBody = init?.body != null && init.body !== "";
  const headers = new Headers(init?.headers);

  if (hasBody && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  if (!headers.has("Authorization")) {
    const token = await resolveAuthToken(options?.retried ?? false);
    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }
  }

  let response: Response;
  try {
    response = await fetch(`${getApiBase()}${path}`, {
      ...init,
      headers,
    });
  } catch {
    throw new KnowledgeIndexApiError(
      `Cannot reach LedgeIndex API at ${getApiBase()}. Is the LedgeIndex server running?`,
      0,
    );
  }

  const text = await response.text();
  let data: unknown = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      if (!response.ok) {
        throw new KnowledgeIndexApiError(text || "Request failed", response.status);
      }
    }
  }

  if (response.status === 401 && !options?.retried) {
    const refreshed = await resolveAuthToken(true);
    if (refreshed) {
      return fetchWithAuth(path, init, { ...options, retried: true });
    }
  }

  return { response, data };
}

async function requestApi<T>(
  path: string,
  init?: RequestInit,
  options?: { notFoundAsNull?: boolean; retried?: boolean },
): Promise<T | null> {
  const { response, data } = await fetchWithAuth(path, init, options);

  if (!response.ok) {
    if (options?.notFoundAsNull && response.status === 404) {
      return null;
    }
    const payload = data as { error?: unknown; message?: unknown };
    const message = formatApiErrorPayload(payload.error, data);
    throw new KnowledgeIndexApiError(message, response.status);
  }

  return data as T;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const result = await requestApi<T>(path, init);
  if (result === null) {
    throw new KnowledgeIndexApiError("Not found", 404);
  }
  return result;
}

async function tryApi<T>(path: string, init?: RequestInit): Promise<T | null> {
  return requestApi<T>(path, init, { notFoundAsNull: true });
}

export function normalizeStartUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return trimmed;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

export const UNSUPPORTED_PDF_START_URL_MESSAGE =
  "PDF URLs are not supported for web crawl. Use an HTML docs page as the start URL.";

/** True when the URL path looks like a PDF (filename / extension). */
export function isPdfUrl(input: string): boolean {
  const trimmed = input.trim();
  if (!trimmed) return false;

  try {
    const url = new URL(normalizeStartUrl(trimmed));
    const path = url.pathname.toLowerCase();
    return path.endsWith(".pdf") || /\/[^/]+\.pdf\//i.test(path);
  } catch {
    return /\.pdf(?:$|[?#])/i.test(trimmed);
  }
}

export type DiscoverySignal = {
  found: boolean;
  url: string;
  disallowRules?: number;
  pageCount?: number;
};

export type DiscoverySignals = {
  robots: DiscoverySignal;
  sitemap: DiscoverySignal;
};

export type PreflightResult = {
  url: string;
  ok: boolean;
  status: number;
  siteName: string;
  title?: string;
  ogImage?: string;
  faviconUrl?: string;
  discovery: DiscoverySignals;
  metadata: SourceMetadata;
};

export async function preflightSite(
  url: string,
  signal?: AbortSignal,
  sitemapUrls?: string[],
) {
  return api<{ preflight: PreflightResult }>("/api/preflight", {
    method: "POST",
    body: JSON.stringify({
      url: normalizeStartUrl(url),
      ...(sitemapUrls?.length ? { sitemapUrls } : {}),
    }),
    signal,
  });
}

export type CrawlUrlFilterMessage = {
  role: "user" | "assistant";
  content: string;
};

export async function filterCrawlUrls(input: {
  message: string;
  urls: Array<{ index: number; url: string; title?: string }>;
  selectedIndexes: number[];
  history?: CrawlUrlFilterMessage[];
  modelId?: string;
  /** Preferred: api / lm-studio / ag-native selection. */
  model?: {
    backend?: string;
    modelId?: string;
    baseUrl?: string;
    googleModelId?: string;
  };
  backend?: string;
  baseUrl?: string;
  googleModelId?: string;
}) {
  const result = await api<{
    filter: {
      selectedIndexes: number[];
      summary: string;
      modelId: string;
      truncated?: boolean;
      totalUrls?: number;
    };
  }>("/api/crawl/url-filter", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return result.filter;
}

/** Filter: AI returns indexes/patterns to remove (compact catalog).
 * Uses existing `/api/crawl/url-filter` with mode=removals when the server
 * supports it; falls back to keep-list filtering on older/cloud APIs. */
export async function proposeCrawlFilterRemovals(input: {
  urls: Array<{ index: number; url: string; title?: string }>;
  startUrls?: string[];
  modelId?: string;
  model?: {
    backend?: string;
    modelId?: string;
    baseUrl?: string;
    googleModelId?: string;
  };
  backend?: string;
  baseUrl?: string;
  googleModelId?: string;
}) {
  const allIndexes = input.urls.map((entry) => entry.index);
  const REMOVALS_MESSAGE = [
    "Clean this crawl for indexing.",
    "Deselect (remove from selection):",
    "1) Not-found / error pages (titles like Page not found, 404, GitHub Pages not-found, does not exist)",
    "2) Next/previous/legacy version trees when a primary current docs tree exists (v1, v2 alt, beta, canary, next, preview, old)",
    "3) Parallel noise: blog, changelog, news, release-notes, authors, tags, archives",
    "Keep the primary current documentation tree.",
    "Return the cleaned selectedIndexes (0-based) for URLs to KEEP.",
  ].join("\n");

  // Prefer dedicated removals route when deployed (local / new cloud).
  try {
    const result = await api<{
      removals: {
        removeIndexes: number[];
        excludePatterns: string[];
        selectedIndexes: number[];
        summary: string;
        modelId: string;
        truncated?: boolean;
        totalUrls?: number;
      };
    }>("/api/crawl/url-removals", {
      method: "POST",
      body: JSON.stringify(input),
    });
    return result.removals;
  } catch (err) {
    if (!(err instanceof KnowledgeIndexApiError) || err.status !== 404) {
      throw err;
    }
  }

  // Cloud / older API: existing url-filter endpoint (keep-list → derive removals).
  const filter = await filterCrawlUrls({
    message: REMOVALS_MESSAGE,
    urls: input.urls,
    selectedIndexes: allIndexes,
    modelId: input.modelId,
    model: input.model,
    backend: input.backend,
    baseUrl: input.baseUrl,
    googleModelId: input.googleModelId,
  });

  const keep = new Set(filter.selectedIndexes);
  const removeIndexes = allIndexes.filter((index) => !keep.has(index));

  return {
    removeIndexes,
    excludePatterns: [] as string[],
    selectedIndexes: filter.selectedIndexes,
    summary: filter.summary,
    modelId: filter.modelId,
    ...(filter.truncated ? { truncated: true, totalUrls: filter.totalUrls } : {}),
  };
}

export async function createProject(name: string) {
  return api<{ project: { id: string; name: string } }>("/api/projects", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export async function checkSourceDuplicates(input: {
  url: string;
  scope?: SourceScope;
  versionLabel?: string;
}) {
  const params = new URLSearchParams({
    url: input.url,
    scope: input.scope ?? "personal",
  });
  if (input.versionLabel) {
    params.set("versionLabel", input.versionLabel);
  }
  return api<{ duplicate: SourceDuplicateMatch | null }>(
    `/api/sources/duplicates?${params.toString()}`,
  );
}

export async function createSource(input: {
  projectId?: string;
  name: string;
  scope?: SourceScope;
  hosting?: SourceHosting;
  config: WebCrawlConfig;
  sourceMetadata?: SourceMetadata | null;
  versionMode?: "new" | "replace";
  replaceSourceId?: string;
  versionLabel?: string;
}) {
  return api<{ source: Source; replaced?: boolean }>("/api/sources", {
    method: "POST",
    body: JSON.stringify({ ...input, type: "web_crawl" }),
  });
}

export async function getSource(id: string) {
  return api<{ source: Source }>(`/api/sources/${id}`);
}

export async function updateSource(
  id: string,
  input: {
    name?: string;
    slug?: string;
    config?: WebCrawlConfig;
    ogImageUrl?: string | null;
    faviconUrl?: string | null;
    sourceMetadata?: SourceMetadata | null;
    categories?: string[];
    displayOrder?: number | null;
  },
) {
  return api<{ source: SourceSummary }>(`/api/sources/${id}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export async function reorderSources(
  items: Array<{ id: string; displayOrder: number }>,
) {
  return api<{ updated: number }>(`/api/sources/reorder`, {
    method: "PUT",
    body: JSON.stringify({ items }),
  });
}

export async function updateSourceCategories(id: string, categories: string[]) {
  return updateSource(id, { categories });
}

export async function updateSourceDocsIdentity(
  id: string,
  docsIdentity: DocsIdentity,
) {
  return api<{ source: Source; docsIdentity: DocsIdentity }>(
    `/api/sources/${id}/docs-identity`,
    {
      method: "PUT",
      body: JSON.stringify(docsIdentity),
    },
  );
}

export async function updateSourceSiteProfile(
  id: string,
  siteProfile: SiteProfile,
) {
  const MAX_LENS_SOURCE_URLS = 80;
  const sanitized: SiteProfile = {
    ...siteProfile,
    lensSources: siteProfile.lensSources
      ? Object.fromEntries(
          Object.entries(siteProfile.lensSources).map(([lensId, entry]) => [
            lensId,
            {
              urls: (entry.urls ?? []).slice(0, MAX_LENS_SOURCE_URLS),
              titles: (entry.titles ?? []).slice(0, MAX_LENS_SOURCE_URLS),
              ...(entry.pickSummary?.trim()
                ? { pickSummary: entry.pickSummary.trim().slice(0, 4000) }
                : {}),
            },
          ]),
        )
      : undefined,
  };

  try {
    return await api<{ source: Source; siteProfile: SiteProfile }>(
      `/api/sources/${id}/site-profile`,
      {
        method: "PUT",
        body: JSON.stringify(sanitized),
      },
    );
  } catch (err) {
    // Older API builds may not have the dedicated route yet — merge via updateSource.
    if (
      !(err instanceof KnowledgeIndexApiError) ||
      err.status !== 404
    ) {
      throw err;
    }

    const { source } = await getSource(id);
    const prev = source.sourceMetadata;
    const now = new Date().toISOString();
    const nextMetadata: SourceMetadata = {
      sourceType: prev?.sourceType ?? "documentation",
      sourceTypeConfidence: prev?.sourceTypeConfidence ?? 0.5,
      origin: prev?.origin ?? "external",
      version: prev?.version ?? null,
      versionSource: prev?.versionSource ?? null,
      detectedSignals: prev?.detectedSignals ?? [],
      llmsTxt: prev?.llmsTxt ?? null,
      ...prev,
      siteProfile: {
        ...sanitized,
        updatedAt: now,
        generatedAt: sanitized.generatedAt ?? now,
      },
    };

    const { source: updated } = await updateSource(id, {
      sourceMetadata: nextMetadata,
    });
    return {
      source: updated as unknown as Source,
      siteProfile: nextMetadata.siteProfile!,
    };
  }
}

export async function deleteSourceSiteProfile(id: string) {
  try {
    return await api<{ source: Source; deleted: boolean }>(
      `/api/sources/${id}/site-profile`,
      { method: "DELETE" },
    );
  } catch (err) {
    if (
      !(err instanceof KnowledgeIndexApiError) ||
      err.status !== 404
    ) {
      throw err;
    }

    const { source } = await getSource(id);
    const prev = source.sourceMetadata;
    const nextMetadata: SourceMetadata = {
      sourceType: prev?.sourceType ?? "documentation",
      sourceTypeConfidence: prev?.sourceTypeConfidence ?? 0.5,
      origin: prev?.origin ?? "external",
      version: prev?.version ?? null,
      versionSource: prev?.versionSource ?? null,
      detectedSignals: prev?.detectedSignals ?? [],
      llmsTxt: prev?.llmsTxt ?? null,
      ...prev,
    };
    delete nextMetadata.siteProfile;

    const { source: updated } = await updateSource(id, {
      sourceMetadata: nextMetadata,
    });
    return { source: updated as unknown as Source, deleted: true };
  }
}

export async function deleteSource(id: string) {
  return api<{ deleted: boolean; sourceId: string }>(`/api/sources/${id}`, {
    method: "DELETE",
  });
}

export async function listProjects() {
  return api<{ projects: { id: string; name: string }[] }>("/api/projects");
}

export async function listSources(scope?: SourceScope | "all") {
  const query =
    scope && scope !== "all" ? `?scope=${encodeURIComponent(scope)}` : "";
  return api<{ sources: SourceSummary[] }>(`/api/sources${query}`);
}

export async function listSourceCategories(scope?: SourceScope | "all") {
  const query =
    scope && scope !== "all" ? `?scope=${encodeURIComponent(scope)}` : "";
  return api<{ categories: SourceCategoryOption[] }>(
    `/api/source-categories${query}`,
  );
}

export async function getSourceSummary(id: string) {
  return api<{ summary: SourceSummary }>(`/api/sources/${id}/summary`);
}

export type RepoProfilePrimitive = {
  name: string;
  kind: string;
  description: string;
  importFrom?: string | null;
  sourcePath?: string | null;
};

export type RepoProfileExample = {
  kind: string;
  title: string;
  description: string;
  language?: string | null;
  body: string;
  sourcePath?: string | null;
};

export type RepoProfile = {
  libraryName: string;
  description: string;
  summary: string;
  primitives: RepoProfilePrimitive[];
  examples: RepoProfileExample[];
  filesConsulted: string[];
  profiledAt?: string;
};

/** Multi-step repo profiler (description + primitives + examples). */
export async function profileRepoCheckout(input: {
  checkoutPath: string;
  githubUrl?: string;
  libraryName?: string;
  maxExamples?: number;
}) {
  return api<{
    ok: boolean;
    status: string;
    profile?: RepoProfile;
    examples?: unknown[];
    error?: string;
    toolCalls?: number;
    toolResults?: number;
  }>("/api/repo/profile", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export type MetadataCatalogSection = {
  name: string;
  chunkCount: number;
};

export type MetadataCatalogPage = {
  url: string;
  title: string;
  chunkCount: number;
};

export type MetadataCatalogCategory = {
  name: string;
  chunkCount: number;
  pageCount: number;
  sections: MetadataCatalogSection[];
};

export type MetadataCatalog = {
  sourceId: string;
  categories: MetadataCatalogCategory[];
  pages: MetadataCatalogPage[];
  updatedAt: string;
};

export async function getMetadataCatalog(sourceId: string) {
  return api<{
    sourceId: string;
    catalog: MetadataCatalog | null;
    vectorBackend: string;
  }>(`/api/sources/${sourceId}/metadata-catalog`);
}

export type ExampleCatalogEntry = {
  url: string;
  pageTitle: string;
  exampleTitle: string;
  kind: string;
  language: string | null;
  section: string;
  exampleIndex: number;
};

export type ExampleCatalog = {
  sourceId: string;
  examples: ExampleCatalogEntry[];
  updatedAt: string;
};

export async function getExampleCatalog(sourceId: string) {
  return api<{
    sourceId: string;
    catalog: ExampleCatalog | null;
    exampleCount: number;
  }>(`/api/sources/${sourceId}/example-catalog`);
}

export type PageChunk = {
  id: string;
  chunkIndex: number;
  text: string;
  title: string;
  url: string;
  category: string;
  section: string;
  headingPath: string[];
};

export type PageChunksResult = {
  sourceId: string;
  url: string;
  title: string;
  chunkCount: number;
  chunks: PageChunk[];
  markdown: string;
  vectorBackend?: string;
};

/** Indexed chunk text for one page (debug / MD preview). */
export async function getPageChunks(sourceId: string, url: string) {
  const params = new URLSearchParams({ url });
  return api<PageChunksResult>(
    `/api/sources/${sourceId}/page-chunks?${params.toString()}`,
  );
}

export type PageExample = {
  id: string;
  exampleIndex: number;
  examplePartIndex?: number;
  title: string;
  kind: string;
  language: string | null;
  section: string;
  body: string;
  embedText: string;
  url: string;
  pageSummary: string;
  apiResponse?: {
    httpStatus?: number | null;
    statusText?: string | null;
    errorCode?: string | null;
    contentType?: string | null;
  } | null;
};

export type PageExamplesResult = {
  sourceId: string;
  url: string;
  title: string;
  exampleCount: number;
  examples: PageExample[];
  vectorBackend?: string;
};

/** Indexed examples for one page (preview next to MD / chunks). */
export async function getPageExamples(sourceId: string, url: string) {
  const params = new URLSearchParams({ url });
  return api<PageExamplesResult>(
    `/api/sources/${sourceId}/page-examples?${params.toString()}`,
  );
}

export async function askSource(
  sourceId: string,
  message: string,
  options?: {
    rerankBackend?: DocsAskRerankBackend | string;
    model?: DocsAskModelSelection;
  },
) {
  return api<SourceAskResult>(`/api/sources/${sourceId}/ask`, {
    method: "POST",
    body: JSON.stringify({
      message,
      ...(options?.rerankBackend
        ? { rerankBackend: options.rerankBackend }
        : {}),
      ...(options?.model ? { model: options.model } : {}),
    }),
  });
}

export type FoundExample = {
  title: string;
  kind: string;
  language: string | null;
  section: string;
  body: string;
  url: string;
  score: number;
  exampleIndex: number;
  pageSummary?: string;
  apiResponse?: {
    httpStatus?: number | null;
    statusText?: string | null;
    errorCode?: string | null;
    contentType?: string | null;
  } | null;
};

export type FindExamplesResult = {
  sourceId: string;
  examples: FoundExample[];
  rewrittenQueries: string[];
  rewriteMethod: "llm" | "fallback" | "skipped" | "cascade";
  exampleKind?: string;
  language?: string;
  retrieval?: {
    question: string;
    rewrittenQueries: string[];
    rewriteMethod: "llm" | "fallback" | "skipped" | "cascade";
    insufficient: boolean;
    relaxedPassUsed: boolean;
    maxChunkScore?: number;
    avgTop3Score?: number;
    searchAttempts: Array<{
      query: string;
      initialCount: number;
      rerankedCount: number;
      directHitCount: number;
      directHitScores: number[];
      insufficient: boolean;
      relaxedPassUsed: boolean;
    }>;
    chunks: Array<{
      text: string;
      url: string;
      title: string;
      score: number;
      category: string;
      section: string;
    }>;
  };
};

export async function findExamples(
  sourceId: string,
  input: {
    query: string;
    kind?: "code" | "setup" | "usage" | "config" | "other";
    language?: string;
    topK?: number;
    rerankBackend?: DocsAskRerankBackend;
  },
) {
  return api<FindExamplesResult>(`/api/sources/${sourceId}/find-examples`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function runCrawlPreview(sourceId: string) {
  return api<{ crawlRun: CrawlRun }>(`/api/sources/${sourceId}/crawl-preview`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export async function getCrawlRun(crawlRunId: string) {
  return api<{ crawlRun: CrawlRun }>(`/api/crawl-runs/${crawlRunId}`);
}

export async function runParsePreview(
  sourceId: string,
  input: {
    urls: string[];
    contentSelectors?: string[];
    excludeSelectors?: string[];
  },
) {
  return api<{ pages: ParsePreviewPage[] }>(
    `/api/sources/${sourceId}/parse-preview`,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
}

export async function startIngestWorkflow(
  sourceId: string,
  input?: { config?: WebCrawlConfig },
  signal?: AbortSignal,
) {
  return api<{ snapshot: IngestPipelineSnapshot }>(
    `/api/sources/${sourceId}/ingest/start`,
    {
      method: "POST",
      body: JSON.stringify(input ?? {}),
      signal,
    },
  );
}

export async function cancelIngestCrawl(sourceId: string) {
  return api<{ cancelled: boolean }>(`/api/sources/${sourceId}/ingest/cancel`, {
    method: "POST",
  });
}

/** Cancels an active crawl and/or in-progress indexing for a source. */
export const cancelIngest = cancelIngestCrawl;

export type CrawlProgress = {
  active: boolean;
  status?: "running" | "done";
  phase?: "discovering" | "validating";
  pagesDiscovered: number;
  maxPages: number;
  validatedCount?: number;
  validationTotal?: number;
  httpErrorCount?: number;
};

export async function getCrawlProgress(sourceId: string) {
  return api<CrawlProgress>(`/api/sources/${sourceId}/crawl-progress`);
}

export async function resumeIngestWorkflow(
  sourceId: string,
  runId: string,
  input:
    | {
        step: "crawl-review-step";
        resumeData: {
          selectedUrls: string[];
          /** When true, run LLM example enrichment after parse. Default false. */
          enrichExamples?: boolean;
          enrichBackend?: string;
          enrichModelId?: string;
          enrichBaseUrl?: string;
          enrichGoogleModelId?: string;
          /** Model context window (tokens) from AutomationGhost / LM Studio. */
          enrichContextTokenLimit?: number;
        };
      }
    | {
        step: "parse-review-step";
        resumeData: {
          confirmed: true;
          enrichExamples?: boolean;
          enrichBackend?: string;
          enrichModelId?: string;
          enrichBaseUrl?: string;
          enrichGoogleModelId?: string;
          enrichContextTokenLimit?: number;
        };
      }
    | {
        step: "enrich-step";
        resumeData:
          | { confirmed: true }
          | { action: "retry_failed"; enrichContextTokenLimit?: number }
          | {
              action: "retry_urls";
              urls: string[];
              enrichContextTokenLimit?: number;
            };
      },
) {
  return api<{ snapshot: IngestPipelineSnapshot }>(
    `/api/sources/${sourceId}/ingest/${runId}/resume`,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
}

export async function getIngestWorkflowStatus(sourceId: string, runId: string) {
  return api<{ snapshot: IngestPipelineSnapshot }>(
    `/api/sources/${sourceId}/ingest/${runId}`,
  );
}

export async function tryGetIngestWorkflowStatus(
  sourceId: string,
  runId: string,
): Promise<IngestPipelineSnapshot | null> {
  const result = await tryApi<{ snapshot: IngestPipelineSnapshot }>(
    `/api/sources/${sourceId}/ingest/${runId}`,
  );
  return result?.snapshot ?? null;
}

export type RefreshPageRef = {
  url: string;
  title: string;
};

export type RefreshChangelog = {
  baselineCaptured: boolean;
  unchangedCount: number;
  added: RefreshPageRef[];
  updated: RefreshPageRef[];
  removed: RefreshPageRef[];
};

export type RefreshMode = "discover" | "selected";

export type RefreshRunStatus =
  | "discovering"
  | "parsing"
  | "comparing"
  | "ready"
  | "applying"
  | "done"
  | "cancelled"
  | "failed";

export type RefreshRunPhase =
  | "discovering"
  | "parsing"
  | "comparing"
  | "embedding"
  | "storing"
  | "done";

export type RefreshRunSnapshot = {
  runId: string;
  sourceId: string;
  crawlRunId: string;
  mode: RefreshMode;
  status: RefreshRunStatus;
  phase: RefreshRunPhase;
  current: number;
  total: number;
  /** Current start-path label while discovering multi-path sources (e.g. `/docs`). */
  activePath?: string;
  /** 1-based index of the start path currently being crawled. */
  pathIndex?: number;
  /** Total start paths in this refresh discover pass. */
  pathTotal?: number;
  changelog?: RefreshChangelog;
  error?: string;
};

export async function startSourceRefreshCheck(
  sourceId: string,
  mode: RefreshMode = "discover",
) {
  return api<{ snapshot: RefreshRunSnapshot }>(
    `/api/sources/${sourceId}/refresh/start`,
    {
      method: "POST",
      body: JSON.stringify({ mode }),
    },
  );
}

export async function getSourceRefreshStatus(sourceId: string) {
  return api<{ snapshot: RefreshRunSnapshot | null }>(
    `/api/sources/${sourceId}/refresh/status`,
  );
}

export async function cancelSourceRefresh(sourceId: string) {
  return api<{ cancelled: boolean }>(
    `/api/sources/${sourceId}/refresh/cancel`,
    { method: "POST" },
  );
}

export async function applySourceRefresh(sourceId: string) {
  return api<{ snapshot: RefreshRunSnapshot }>(
    `/api/sources/${sourceId}/refresh/apply`,
    { method: "POST" },
  );
}

export async function dismissSourceRefresh(sourceId: string) {
  return api<{ dismissed: boolean }>(
    `/api/sources/${sourceId}/refresh/dismiss`,
    { method: "POST" },
  );
}

export async function indexPreviewPages(
  sourceId: string,
  pages: Array<{
    url: string;
    title: string;
    markdown: string;
    language?: string;
    contentType?: string;
  }>,
) {
  return api<{
    indexed: boolean;
    chunkCount: number;
    pageCount: number;
    vectorBackend: string;
  }>(`/api/sources/${sourceId}/index-preview`, {
    method: "POST",
    body: JSON.stringify({ pages }),
  });
}

export async function estimateIndexSize(
  sourceId: string,
  input: {
    urls: string[];
    selectedUrlCount?: number;
    contentSelectors?: string[];
    excludeSelectors?: string[];
  },
) {
  return api<{ estimate: IndexSizeEstimate }>(
    `/api/sources/${sourceId}/index-estimate`,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
}

export type ApiKeySummary = {
  id: string;
  name: string;
  key_prefix: string;
  key_value: string | null;
  created_at: string;
  last_used_at: string | null;
  scopes: string[];
  is_default: boolean;
};

export async function ensurePlaygroundApiKey() {
  return api<{
    success: boolean;
    data: ApiKeySummary[];
    provisioned_key?: string;
  }>("/api/auth/api-keys/ensure-playground", {
    method: "POST",
  });
}

export async function getAuthMe() {
  return api<{ role: "user" | "admin" }>("/api/auth/me");
}

export async function listApiKeys() {
  return api<{
    success: boolean;
    data: ApiKeySummary[];
    meta: {
      api_key_limit: number;
      current_count: number;
      can_create: boolean;
      can_revoke: boolean;
    };
    provisioned_key?: string;
  }>("/api/auth/api-keys");
}

export async function createApiKey() {
  return api<{
    success: boolean;
    data: {
      apiKey: string;
      keyId: string;
      name: string;
      scopes: string[];
    };
    message?: string;
  }>("/api/auth/api-keys", {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export async function deleteApiKey(keyId: string) {
  return api<{ success: boolean; message?: string }>(
    `/api/auth/api-keys/${keyId}`,
    { method: "DELETE" },
  );
}

export type SourceSetMember = {
  id: string;
  slug: string;
  name: string;
  scope: SourceScope;
};

export type SourceSetSummary = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  sourceCount: number;
  sources: SourceSetMember[];
};

export function getMastraApiBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_KNOWLEDGEINDEX_MASTRA_URL ??
    process.env.NEXT_PUBLIC_LEDGEINDEX_MASTRA_URL ??
    getLedgeIndexApiBaseUrl()
  );
}

export async function listSourceSets() {
  return api<{ sourceSets: SourceSetSummary[] }>("/api/source-sets");
}

export async function getSourceSet(idOrSlug: string) {
  return api<{ sourceSet: SourceSetSummary }>(`/api/source-sets/${idOrSlug}`);
}

export async function createSourceSet(input: {
  name: string;
  slug?: string;
  description?: string | null;
  sourceIds: string[];
}) {
  return api<{ sourceSet: SourceSetSummary }>("/api/source-sets", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateSourceSet(
  idOrSlug: string,
  input: {
    name?: string;
    slug?: string;
    description?: string | null;
    sourceIds?: string[];
  },
) {
  return api<{ sourceSet: SourceSetSummary }>(`/api/source-sets/${idOrSlug}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export async function deleteSourceSet(idOrSlug: string) {
  return api<{ deleted: boolean; sourceSetId: string }>(
    `/api/source-sets/${idOrSlug}`,
    { method: "DELETE" },
  );
}

export type ProfileResearchLensRef = {
  id: string;
  label: string;
};

export type ProfileSiteRunProgress = {
  phase: "crawl" | "pick" | "fetch" | "synthesize";
  lens?: string;
  index?: number;
  total?: number;
  subphase?: "inventory" | "examples";
  primitiveName?: string;
};

export type ProfileLensSourceEntry = {
  urls: string[];
  titles: string[];
  pickSummary?: string;
  pageMarkdownByUrl?: Record<string, string>;
};

export type ProfileSiteRun = {
  id: string;
  rootUrl: string;
  lenses: string[];
  status: "running" | "completed" | "failed";
  createdAt: string;
  completedAt?: string;
  error?: string;
  progress?: ProfileSiteRunProgress;
  profile?: Record<string, unknown>;
  lensSources?: Record<string, ProfileLensSourceEntry>;
  modelId?: string;
  crawlPageCount?: number;
};

export async function listProfileLenses() {
  return api<{ lenses: ProfileResearchLensRef[] }>("/api/profile/lenses");
}

export type ProfileSeedCatalogPage = {
  url: string;
  title: string;
  markdown?: string;
};

export async function startProfileSiteRun(input: {
  url: string;
  lenses?: string[];
  maxPages?: number;
  sitemapOnly?: boolean;
  /** Skip crawl; pick from these pages (markdown skips HTTP fetch). */
  seedPages?: ProfileSeedCatalogPage[];
  backend?: string;
  modelId?: string;
  baseUrl?: string;
  googleModelId?: string;
}) {
  return api<{ run: ProfileSiteRun }>("/api/profile/site-runs", {
    method: "POST",
    body: JSON.stringify({
      url: input.url,
      ...(input.lenses?.length ? { lenses: input.lenses } : {}),
      ...(input.maxPages != null ? { maxPages: input.maxPages } : {}),
      ...(input.sitemapOnly ? { sitemapOnly: true } : {}),
      ...(input.seedPages?.length ? { seedPages: input.seedPages } : {}),
      ...(input.backend ? { backend: input.backend } : {}),
      ...(input.modelId ? { modelId: input.modelId } : {}),
      ...(input.baseUrl ? { baseUrl: input.baseUrl } : {}),
      ...(input.googleModelId ? { googleModelId: input.googleModelId } : {}),
    }),
  });
}

export async function getProfileSiteRun(runId: string) {
  return api<{ run: ProfileSiteRun }>(`/api/profile/site-runs/${runId}`);
}
