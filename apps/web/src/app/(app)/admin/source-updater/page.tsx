"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ClipboardList, RefreshCw, SearchCheck, Square } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import type { KnowledgeSetScope } from "@/components/sources/knowledge-set-scope-toggle";
import { IngestPipelineFlow } from "@/components/sources/ingest-pipeline-flow";
import { CachedRemoteImage } from "@/components/sources/cached-remote-image";
import { formatUrlLabel } from "@/components/sources/source-display";
import { FilterBadge } from "@/components/sources/source-category-filter";
import { resolveSourceStorage } from "@/components/sources/source-cloud-badge";
import { pageCatalogPathLabel } from "@/lib/catalog-view";
import { IDLE_INGEST_PIPELINE } from "@/lib/ingest-pipeline";
import {
  pipelineFromCatalogIngest,
  pipelineFromRefreshSnapshot,
  refreshHasChanges,
} from "@/lib/admin-source-updater";
import {
  syncApiBaseForHosting,
  syncDesktopApiBaseForScope,
} from "@/lib/desktop-api-routing";
import { getDevProjectId, setDevProjectId } from "@/lib/dev-project";
import { getLedgeIndexDesktop } from "@/lib/ledgeindex-desktop";
import { publicAssetUrl } from "@/lib/public-asset-url";
import { useHostingCapabilities } from "@/lib/use-hosting-capabilities";
import { cn } from "@/lib/utils";
import {
  applySourceRefresh,
  cancelIngest,
  cancelSourceRefresh,
  checkSourceDuplicates,
  createProject,
  createSource,
  dismissSourceRefresh,
  getCrawlProgress,
  getIngestWorkflowStatus,
  getSource,
  getSourceRefreshStatus,
  KnowledgeIndexApiError,
  listSources,
  resumeIngestWorkflow,
  startIngestWorkflow,
  startSourceRefreshCheck,
  updateSource,
  type IngestPipelineSnapshot,
  type RefreshChangelog,
  type RefreshPageRef,
  type RefreshRunSnapshot,
  type SourceHosting,
  type SourceMetadata,
  type SourceSummary,
  type WebCrawlConfig,
} from "@/lib/ledgeindex-api";
import {
  isCatalogEntryCrawlReady,
  normalizeCatalogEntry,
  compareCuratedTopDocs,
  curatedTopDocsRank,
  isCuratedTopDocsPackage,
  CURATED_TOP_DOCS_PACKAGES,
  effectiveCatalogDocsUrl,
  type TypescriptDocsCatalog,
  type TypescriptDocsCatalogEntry,
} from "@/lib/typescript-docs-catalog";
import { CatalogPathsMaintainPanel } from "@/components/admin/catalog-paths-maintain-panel";
import { CatalogManualPackageForm } from "@/components/admin/catalog-manual-package-form";
import type { DocsIdentityKind } from "@/lib/source-metadata";

type UpdaterTab = "sources" | "catalog";
type StorageFilter = "all" | "local" | "cloud";
type CatalogCrawlMode = "full" | "paths-only";
type CatalogCategoryFilter =
  | "all"
  | "frameworks"
  | "libraries"
  | "apis-services"
  | "tooling"
  | "uncategorized";
type CatalogRankMode = "downloads" | "pagerank";
type CatalogPathsFilter =
  | "all"
  | "discovered"
  | "uncertain"
  | "missing"
  | "failed";

const CATALOG_RANK_OPTIONS: readonly {
  value: CatalogRankMode;
  label: string;
}[] = [
  { value: "pagerank", label: "PageRank" },
  { value: "downloads", label: "Downloads" },
];

const CATALOG_CATEGORY_OPTIONS: readonly {
  value: CatalogCategoryFilter;
  label: string;
}[] = [
  { value: "all", label: "All shelves" },
  { value: "frameworks", label: "Frameworks" },
  { value: "libraries", label: "Libraries" },
  { value: "apis-services", label: "APIs / services" },
  { value: "tooling", label: "Tooling" },
  { value: "uncategorized", label: "Uncategorized" },
];

const CATALOG_PATHS_FILTER_OPTIONS: readonly {
  value: CatalogPathsFilter;
  label: string;
}[] = [
  { value: "all", label: "All paths" },
  { value: "discovered", label: "Discovered" },
  { value: "uncertain", label: "Uncertain" },
  { value: "missing", label: "Missing" },
  { value: "failed", label: "Failed" },
];

const CATALOG_DATA_PATH = "data/typescript-docs-catalog.json";

function catalogDataUrl(cacheBust = false): string {
  const base = publicAssetUrl(CATALOG_DATA_PATH);
  if (!cacheBust) return base;
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}t=${Date.now()}`;
}

function catalogPathsBucket(
  entry: TypescriptDocsCatalogEntry,
): CatalogPathsFilter {
  const status = (entry.pathsStatus || "").toLowerCase();
  if (status === "failed") return "failed";
  if (status === "uncertain") return "uncertain";
  if (status === "discovered") return "discovered";
  if (!status || entry.paths.length === 0) return "missing";
  return "missing";
}

function matchesCatalogPathsFilter(
  entry: TypescriptDocsCatalogEntry,
  filter: CatalogPathsFilter,
): boolean {
  if (filter === "all") return true;
  return catalogPathsBucket(entry) === filter;
}

type RowStatus =
  | "idle"
  | "queued"
  | "running"
  | "checking"
  | "up-to-date"
  | "changes-found"
  | "updated"
  | "error"
  | "cancelled";

type SourceRunMode = "check" | "update";

type SourceRunReport = {
  changelog: RefreshChangelog;
  status: RowStatus;
  mode: SourceRunMode;
  finishedAt: number;
};

type SourceRunReportMeta = {
  mode: SourceRunMode;
  finishedAt: number;
  fromSaved: boolean;
};

const POLL_MS = 1500;

function changelogHasDiff(
  changelog: RefreshChangelog | null | undefined,
): boolean {
  if (!changelog) return false;
  return (
    changelog.added.length > 0 ||
    changelog.updated.length > 0 ||
    changelog.removed.length > 0
  );
}

function changelogSummary(changelog: RefreshChangelog | null | undefined): string {
  if (!changelog) return "";
  const bits = [
    changelog.added.length > 0 ? `${changelog.added.length} added` : null,
    changelog.updated.length > 0 ? `${changelog.updated.length} updated` : null,
    changelog.removed.length > 0 ? `${changelog.removed.length} removed` : null,
  ].filter(Boolean);
  if (bits.length > 0) return bits.join(" · ");
  if (changelog.baselineCaptured) return "Baseline captured";
  if (typeof changelog.unchangedCount === "number") {
    return `${changelog.unchangedCount} unchanged`;
  }
  return "No page changes";
}

function normalizeStoredChangelog(changelog: RefreshChangelog): RefreshChangelog {
  if (changelogHasDiff(changelog) && changelog.baselineCaptured) {
    return { ...changelog, baselineCaptured: false };
  }
  return changelog;
}

function cloneChangelog(changelog: RefreshChangelog): RefreshChangelog {
  return {
    baselineCaptured: changelog.baselineCaptured,
    unchangedCount: changelog.unchangedCount,
    added: changelog.added.map((page) => ({ ...page })),
    updated: changelog.updated.map((page) => ({ ...page })),
    removed: changelog.removed.map((page) => ({ ...page })),
  };
}

function formatReportTime(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function SourceFavicon({ source }: { source: SourceSummary }) {
  const [failed, setFailed] = useState(false);
  const initials = source.name.slice(0, 2).toUpperCase();
  if (source.faviconUrl && !failed) {
    return (
      <CachedRemoteImage
        sourceId={source.id}
        url={source.faviconUrl}
        className="size-6 shrink-0 rounded border border-border bg-background object-contain p-0.5"
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <div
      className="flex size-6 shrink-0 items-center justify-center rounded border border-border bg-surface-raised font-mono text-[0.5rem] font-semibold text-muted"
      aria-hidden
    >
      {initials}
    </div>
  );
}

function statusLabel(status: RowStatus): string {
  switch (status) {
    case "queued":
      return "Queued";
    case "running":
      return "Updating…";
    case "checking":
      return "Checking…";
    case "up-to-date":
      return "Up to date";
    case "changes-found":
      return "Changes found";
    case "updated":
      return "Updated";
    case "error":
      return "Failed";
    case "cancelled":
      return "Cancelled";
    default:
      return "";
  }
}

function sourceExcludePatterns(source: SourceSummary): string[] {
  return source.excludePatterns ?? [];
}

function sourceIncludePatterns(source: SourceSummary): string[] {
  return source.includePatterns ?? [];
}

function resolveStartUrls(source: SourceSummary): string[] {
  const fromList = (source.startUrls ?? []).filter(Boolean);
  if (fromList.length > 0) return [...new Set(fromList)];
  return source.startUrl ? [source.startUrl] : [];
}

function formatStartPathLabel(url: string): string {
  try {
    const path = new URL(url).pathname.replace(/\/+$/, "") || "/";
    return path;
  } catch {
    return formatUrlLabel(url);
  }
}

type PathChangeBucket = {
  label: string;
  added: number;
  updated: number;
  removed: number;
};

function pathLabelForChangedUrl(url: string, startUrls: string[]): string {
  let best: string | null = null;
  let bestLen = -1;
  for (const startUrl of startUrls) {
    try {
      const start = new URL(startUrl);
      const page = new URL(url);
      if (start.origin !== page.origin) continue;
      const startPath = start.pathname.replace(/\/+$/, "") || "/";
      const pagePath = page.pathname.replace(/\/+$/, "") || "/";
      if (
        startPath === "/" ||
        pagePath === startPath ||
        pagePath.startsWith(`${startPath}/`)
      ) {
        if (startPath.length > bestLen) {
          best = startPath;
          bestLen = startPath.length;
        }
      }
    } catch {
      // ignore invalid urls
    }
  }
  if (best) return best;
  try {
    const parts = new URL(url).pathname.split("/").filter(Boolean);
    return parts[0] ? `/${parts[0]}` : "/";
  } catch {
    return "/";
  }
}

function changelogPathBuckets(
  changelog: RefreshChangelog | null | undefined,
  startUrls: string[],
): PathChangeBucket[] {
  if (!changelog || (changelog.baselineCaptured && !changelogHasDiff(changelog)))
    return [];

  const buckets = new Map<string, PathChangeBucket>();
  const touch = (
    pages: RefreshPageRef[],
    key: "added" | "updated" | "removed",
  ) => {
    for (const page of pages) {
      const label = pathLabelForChangedUrl(page.url, startUrls);
      const current = buckets.get(label) ?? {
        label,
        added: 0,
        updated: 0,
        removed: 0,
      };
      current[key] += 1;
      buckets.set(label, current);
    }
  };

  touch(changelog.added, "added");
  touch(changelog.updated, "updated");
  touch(changelog.removed, "removed");

  return [...buckets.values()].sort((a, b) => {
    const totalA = a.added + a.updated + a.removed;
    const totalB = b.added + b.updated + b.removed;
    return totalB - totalA || a.label.localeCompare(b.label);
  });
}

function StartUrlChips({ urls }: { urls: string[] }) {
  if (urls.length <= 1) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {urls.map((url) => (
        <span
          key={url}
          title={url}
          className="max-w-[10rem] truncate rounded border border-accent/35 bg-accent/10 px-1.5 py-0.5 font-mono text-[0.5rem] font-semibold text-accent"
        >
          {formatStartPathLabel(url)}
        </span>
      ))}
    </div>
  );
}

function CrawlFiltersBadge({ source }: { source: SourceSummary }) {
  const excludes = sourceExcludePatterns(source);
  const includes = sourceIncludePatterns(source);
  if (excludes.length === 0 && includes.length === 0) return null;

  const title = [
    excludes.length > 0 ? `Exclude:\n${excludes.join("\n")}` : null,
    includes.length > 0 ? `Include:\n${includes.join("\n")}` : null,
  ]
    .filter(Boolean)
    .join("\n\n");

  return (
    <span
      title={title}
      className="inline-flex shrink-0 items-center gap-1 rounded-md border border-amber-500/35 bg-amber-500/10 px-1.5 py-0.5 font-mono text-[0.5rem] font-semibold tracking-[0.08em] text-amber-800 uppercase dark:text-amber-300"
    >
      Config
      {excludes.length > 0 ? (
        <span className="normal-case tracking-normal">
          · {excludes.length} excl
        </span>
      ) : null}
      {includes.length > 0 ? (
        <span className="normal-case tracking-normal">
          · {includes.length} incl
        </span>
      ) : null}
    </span>
  );
}

type RunCounts = {
  updated: number;
  upToDate: number;
  changesFound: number;
  error: number;
  cancelled: number;
  queued: number;
  running: number;
  done: number;
  total: number;
};

function countRunStatuses(
  runIds: string[],
  rowStatus: Record<string, RowStatus>,
): RunCounts {
  const counts: RunCounts = {
    updated: 0,
    upToDate: 0,
    changesFound: 0,
    error: 0,
    cancelled: 0,
    queued: 0,
    running: 0,
    done: 0,
    total: runIds.length,
  };
  for (const id of runIds) {
    const status = rowStatus[id] ?? "idle";
    if (status === "updated") counts.updated += 1;
    else if (status === "up-to-date") counts.upToDate += 1;
    else if (status === "changes-found") counts.changesFound += 1;
    else if (status === "error") counts.error += 1;
    else if (status === "cancelled") counts.cancelled += 1;
    else if (status === "queued") counts.queued += 1;
    else if (status === "running" || status === "checking") counts.running += 1;
  }
  counts.done =
    counts.updated +
    counts.upToDate +
    counts.changesFound +
    counts.error +
    counts.cancelled;
  return counts;
}

function RunOverview({
  runIds,
  sources,
  rowStatus,
  rowError,
  changelogs,
  runReports,
  running,
  stopping,
  onFocus,
}: {
  runIds: string[];
  sources: SourceSummary[];
  rowStatus: Record<string, RowStatus>;
  rowError: Record<string, string>;
  changelogs: Record<string, RefreshChangelog>;
  runReports: Record<string, SourceRunReport>;
  running: boolean;
  stopping: boolean;
  onFocus: (id: string) => void;
}) {
  if (runIds.length === 0) return null;

  const byId = new Map(sources.map((source) => [source.id, source]));
  const counts = countRunStatuses(runIds, rowStatus);

  const title = running
    ? stopping
      ? "Stopping run…"
      : `Run in progress · ${counts.done} / ${counts.total}`
    : `Run finished · ${counts.done} / ${counts.total}`;

  const listIds = running
    ? runIds.filter((id) => {
        const status = rowStatus[id];
        return (
          status === "error" ||
          status === "cancelled" ||
          status === "queued" ||
          status === "running" ||
          status === "checking"
        );
      })
    : runIds;

  return (
    <div className="rounded-xl border border-border bg-card-solid px-3 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <div className="flex flex-wrap gap-1.5">
          {counts.updated > 0 ? (
            <span className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 font-mono text-[0.5rem] font-semibold tracking-[0.08em] text-emerald-700 uppercase dark:text-emerald-300">
              {counts.updated} updated
            </span>
          ) : null}
          {counts.upToDate > 0 ? (
            <span className="rounded-md border border-emerald-500/20 bg-emerald-500/5 px-2 py-0.5 font-mono text-[0.5rem] font-semibold tracking-[0.08em] text-emerald-700/80 uppercase dark:text-emerald-300/80">
              {counts.upToDate} up to date
            </span>
          ) : null}
          {counts.changesFound > 0 ? (
            <span className="rounded-md border border-amber-500/35 bg-amber-500/10 px-2 py-0.5 font-mono text-[0.5rem] font-semibold tracking-[0.08em] text-amber-800 uppercase dark:text-amber-300">
              {counts.changesFound} with changes
            </span>
          ) : null}
          {counts.error > 0 ? (
            <span className="rounded-md border border-red-500/40 bg-red-500/10 px-2 py-0.5 font-mono text-[0.5rem] font-semibold tracking-[0.08em] text-red-700 uppercase dark:text-red-300">
              {counts.error} failed
            </span>
          ) : null}
          {counts.cancelled > 0 ? (
            <span className="rounded-md border border-border bg-surface-alt px-2 py-0.5 font-mono text-[0.5rem] font-semibold tracking-[0.08em] text-muted uppercase">
              {counts.cancelled} cancelled
            </span>
          ) : null}
          {counts.running > 0 ? (
            <span className="rounded-md border border-accent/40 bg-accent/10 px-2 py-0.5 font-mono text-[0.5rem] font-semibold tracking-[0.08em] text-accent uppercase">
              {counts.running} running
            </span>
          ) : null}
          {counts.queued > 0 ? (
            <span className="rounded-md border border-border bg-surface-alt px-2 py-0.5 font-mono text-[0.5rem] font-semibold tracking-[0.08em] text-muted uppercase">
              {counts.queued} queued
            </span>
          ) : null}
        </div>
      </div>

      {listIds.length > 0 ? (
        <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto border-t border-border pt-2">
          {listIds.map((id) => {
            const source = byId.get(id);
            const savedReport = runReports[id];
            const status = rowStatus[id] ?? savedReport?.status ?? "idle";
            const changelog = changelogs[id] ?? savedReport?.changelog;
            const startUrls = source ? resolveStartUrls(source) : [];
            const pathBuckets = changelogPathBuckets(changelog, startUrls);
            const changeBits = changelog
              ? [
                  changelog.added.length > 0
                    ? `${changelog.added.length} added`
                    : null,
                  changelog.updated.length > 0
                    ? `${changelog.updated.length} updated`
                    : null,
                  changelog.removed.length > 0
                    ? `${changelog.removed.length} removed`
                    : null,
                ].filter(Boolean)
              : [];
            return (
              <li key={id}>
                <button
                  type="button"
                  onClick={() => onFocus(id)}
                  className="flex w-full min-w-0 items-start gap-2 rounded-md px-1.5 py-1 text-left hover:bg-accent/8"
                >
                  <span
                    className={cn(
                      "mt-0.5 shrink-0 rounded border px-1.5 py-0.5 font-mono text-[0.5rem] font-semibold tracking-[0.06em] uppercase",
                      status === "error" &&
                        "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300",
                      status === "running" &&
                        "border-accent/40 bg-accent/10 text-accent",
                      (status === "updated" || status === "up-to-date") &&
                        "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
                      (status === "cancelled" || status === "queued") &&
                        "border-border bg-surface-alt text-muted",
                    )}
                  >
                    {statusLabel(status)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate text-xs font-medium text-foreground">
                        {source?.name ?? id}
                      </span>
                    </span>
                    {rowError[id] ? (
                      <span className="block truncate text-[0.625rem] text-red-600 dark:text-red-300">
                        {rowError[id]}
                      </span>
                    ) : pathBuckets.length > 1 ? (
                      <span className="block truncate text-[0.625rem] text-muted">
                        {pathBuckets.length} paths changed ·{" "}
                        {pathBuckets
                          .slice(0, 3)
                          .map((bucket) => bucket.label)
                          .join(", ")}
                        {pathBuckets.length > 3 ? "…" : ""}
                      </span>
                    ) : changeBits.length > 0 ? (
                      <span className="block truncate text-[0.625rem] text-muted">
                        {changeBits.join(" · ")}
                      </span>
                    ) : status === "up-to-date" ? (
                      <span className="block truncate text-[0.625rem] text-muted">
                        No page changes
                      </span>
                    ) : null}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

function ChangeSection({
  label,
  pages,
  tone,
}: {
  label: string;
  pages: RefreshPageRef[];
  tone: "added" | "updated" | "removed";
}) {
  if (pages.length === 0) return null;

  const toneClass =
    tone === "added"
      ? "text-emerald-600 dark:text-emerald-400"
      : tone === "updated"
        ? "text-amber-600 dark:text-amber-400"
        : "text-red-600 dark:text-red-300";

  return (
    <section className="space-y-1.5">
      <p
        className={cn(
          "font-mono text-[0.5625rem] font-semibold tracking-[0.12em] uppercase",
          toneClass,
        )}
      >
        {label} · {pages.length}
      </p>
      <ul className="max-h-40 divide-y divide-border overflow-y-auto rounded-lg border border-border bg-background">
        {pages.map((page) => (
          <li key={page.url} className="min-w-0 px-2.5 py-1.5">
            <p className="truncate text-[0.6875rem] font-medium text-foreground">
              {page.title || page.url}
            </p>
            <p className="truncate font-mono text-[0.5625rem] text-muted">
              {pageCatalogPathLabel(page.url)}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ChangesSidePanel({
  source,
  changelog,
  status,
  running,
  errorMessage,
  hasLastRun,
  reportMeta,
  onApply,
  onDismiss,
  actionBusy = false,
}: {
  source: SourceSummary | null;
  changelog: RefreshChangelog | null;
  status: RowStatus;
  running: boolean;
  errorMessage?: string;
  hasLastRun: boolean;
  reportMeta?: SourceRunReportMeta | null;
  onApply?: () => void;
  onDismiss?: () => void;
  actionBusy?: boolean;
}) {
  if (!source) {
    return (
      <div className="flex h-full min-h-[16rem] flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card-solid/60 px-4 text-center">
        <p className="text-sm font-medium text-foreground">
          {hasLastRun ? "Run report" : "Page changes"}
        </p>
        <p className="mt-1 max-w-[16rem] text-xs leading-5 text-muted">
          {hasLastRun
            ? "Click a set in the finished run list (or on the left) to open its page diff report."
            : "Select a set on the left. Run Check to compare pages, or Update to apply changes."}
        </p>
      </div>
    );
  }

  const hasDiff = changelogHasDiff(changelog);

  const excludes = sourceExcludePatterns(source);
  const includes = sourceIncludePatterns(source);
  const startUrls = resolveStartUrls(source);
  const pathBuckets = changelogPathBuckets(changelog, startUrls);
  const finished =
    !running &&
    !actionBusy &&
    status !== "running" &&
    (status === "updated" ||
      status === "up-to-date" ||
      status === "changes-found" ||
      status === "error" ||
      status === "cancelled");
  const isChecking = running || status === "checking";
  const isApplying = actionBusy || status === "running";

  return (
    <div className="flex h-full min-h-0 flex-col rounded-xl border border-border bg-card-solid">
      <div className="shrink-0 border-b border-border px-3 py-2.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground">
              {source.name}
            </p>
            {reportMeta || status === "changes-found" ? (
              <p className="mt-0.5 font-mono text-[0.5625rem] font-semibold tracking-[0.08em] text-muted uppercase">
                {status === "changes-found" && !reportMeta?.fromSaved
                  ? "Pending changes"
                  : "Run report"}
                {reportMeta
                  ? ` · ${reportMeta.mode === "check" ? "check" : "update"}`
                  : null}
                {reportMeta?.finishedAt
                  ? ` · ${formatReportTime(reportMeta.finishedAt)}`
                  : null}
              </p>
            ) : null}
          </div>
          <CrawlFiltersBadge source={source} />
        </div>
        <p className="truncate font-mono text-[0.625rem] text-muted">
          {formatUrlLabel(source.startUrl || source.name)}
          {status !== "idle" ? ` · ${statusLabel(status)}` : null}
          {source.pageCount > 0 ? ` · ${source.pageCount} indexed` : null}
        </p>
        <StartUrlChips urls={startUrls} />
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {finished ? (
          <section
            className={cn(
              "rounded-lg border px-2.5 py-2",
              status === "error"
                ? "border-red-500/30 bg-red-500/5"
                : status === "cancelled"
                  ? "border-border bg-surface-alt"
                  : "border-emerald-500/30 bg-emerald-500/5",
            )}
          >
            <p className="text-sm font-medium text-foreground">
              {status === "up-to-date"
                ? "Up to date"
                : status === "changes-found"
                  ? "Changes found"
                : status === "updated"
                  ? "Update finished"
                  : status === "error"
                    ? "Update failed"
                    : "Update cancelled"}
            </p>
            <p className="mt-0.5 text-[0.6875rem] leading-5 text-muted">
              {status === "up-to-date"
                ? "No page changes since the last index."
                : status === "changes-found"
                  ? hasDiff
                    ? `${changelogSummary(changelog)} — review below, then apply or dismiss.`
                    : "Check finished — no diff details."
                : status === "updated"
                  ? hasDiff
                    ? pathBuckets.length > 1
                      ? `Changes across ${pathBuckets.length} paths — details below.`
                      : "Applied the page changes below."
                    : "Refresh completed."
                  : status === "error"
                    ? errorMessage || "Something went wrong during refresh."
                    : "This set was stopped before it finished."}
            </p>
            {status === "changes-found" && hasDiff && changelog ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {changelog.added.length > 0 ? (
                  <span className="rounded-md border border-emerald-500/35 bg-emerald-500/10 px-2 py-0.5 font-mono text-[0.5rem] font-semibold tracking-[0.08em] text-emerald-700 uppercase dark:text-emerald-400">
                    {changelog.added.length} added
                  </span>
                ) : null}
                {changelog.updated.length > 0 ? (
                  <span className="rounded-md border border-amber-500/35 bg-amber-500/10 px-2 py-0.5 font-mono text-[0.5rem] font-semibold tracking-[0.08em] text-amber-700 uppercase dark:text-amber-400">
                    {changelog.updated.length} updated
                  </span>
                ) : null}
                {changelog.removed.length > 0 ? (
                  <span className="rounded-md border border-red-500/35 bg-red-500/10 px-2 py-0.5 font-mono text-[0.5rem] font-semibold tracking-[0.08em] text-red-700 uppercase dark:text-red-300">
                    {changelog.removed.length} removed
                  </span>
                ) : null}
              </div>
            ) : null}
            {status === "changes-found" && onApply && onDismiss ? (
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={actionBusy}
                  onClick={() => onApply()}
                  className="inline-flex h-7 items-center rounded-md border border-foreground/15 bg-foreground px-2.5 font-mono text-[0.5rem] font-semibold tracking-[0.08em] text-background uppercase disabled:opacity-50"
                >
                  {actionBusy ? "Applying…" : "Apply changes"}
                </button>
                <button
                  type="button"
                  disabled={actionBusy}
                  onClick={() => onDismiss()}
                  className="inline-flex h-7 items-center rounded-md border border-border bg-card-solid px-2.5 font-mono text-[0.5rem] font-semibold tracking-[0.08em] text-muted uppercase hover:text-foreground disabled:opacity-50"
                >
                  Dismiss
                </button>
              </div>
            ) : null}
          </section>
        ) : null}

        {pathBuckets.length > 1 ? (
          <section className="space-y-1.5">
            <p className="font-mono text-[0.5rem] font-semibold tracking-[0.1em] text-muted uppercase">
              Paths with changes
            </p>
            <div className="flex flex-wrap gap-1">
              {pathBuckets.map((bucket) => (
                <span
                  key={bucket.label}
                  className="rounded border border-amber-500/35 bg-amber-500/10 px-1.5 py-0.5 font-mono text-[0.5rem] text-amber-800 dark:text-amber-300"
                >
                  {bucket.label}
                  {bucket.added > 0 ? ` · +${bucket.added}` : ""}
                  {bucket.updated > 0 ? ` · ~${bucket.updated}` : ""}
                  {bucket.removed > 0 ? ` · -${bucket.removed}` : ""}
                </span>
              ))}
            </div>
          </section>
        ) : null}

        {(excludes.length > 0 || includes.length > 0) && (
          <section className="space-y-1.5 rounded-lg border border-amber-500/25 bg-amber-500/5 px-2.5 py-2">
            <p className="font-mono text-[0.5rem] font-semibold tracking-[0.1em] text-amber-800 uppercase dark:text-amber-300">
              Saved crawl filters
            </p>
            <p className="text-[0.625rem] leading-4 text-muted">
              Applied on refresh — excluded paths stay out of updates.
            </p>
            {excludes.length > 0 ? (
              <ul className="space-y-0.5">
                {excludes.map((pattern) => (
                  <li
                    key={`ex-${pattern}`}
                    className="truncate font-mono text-[0.625rem] text-red-700 dark:text-red-300"
                    title={pattern}
                  >
                    − {pattern}
                  </li>
                ))}
              </ul>
            ) : null}
            {includes.length > 0 ? (
              <ul className="space-y-0.5">
                {includes.map((pattern) => (
                  <li
                    key={`in-${pattern}`}
                    className="truncate font-mono text-[0.625rem] text-emerald-700 dark:text-emerald-300"
                    title={pattern}
                  >
                    + {pattern}
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        )}

        {isApplying ? (
          <p className="text-xs text-muted">
            Applying page changes — embedding and saving…
          </p>
        ) : null}

        {isChecking && (status === "checking" || status === "running") && !changelog ? (
          <p className="text-xs text-muted">Discovering and comparing pages…</p>
        ) : null}

        {changelog?.baselineCaptured && !hasDiff ? (
          <p className="text-xs leading-5 text-muted">
            Baseline snapshot captured — no diff yet for this set.
          </p>
        ) : null}

        {changelog && !hasDiff ? (
          <p className="text-xs leading-5 text-muted">
            No page changes
            {typeof changelog.unchangedCount === "number"
              ? ` · ${changelog.unchangedCount} unchanged`
              : ""}
            .
          </p>
        ) : null}

        {hasDiff && changelog ? (
          <>
            <div className="flex flex-wrap gap-1.5">
              {changelog.added.length > 0 ? (
                <span className="rounded-md border border-emerald-500/35 bg-emerald-500/10 px-2 py-0.5 font-mono text-[0.5rem] font-semibold tracking-[0.08em] text-emerald-700 uppercase dark:text-emerald-400">
                  {changelog.added.length} added
                </span>
              ) : null}
              {changelog.updated.length > 0 ? (
                <span className="rounded-md border border-amber-500/35 bg-amber-500/10 px-2 py-0.5 font-mono text-[0.5rem] font-semibold tracking-[0.08em] text-amber-700 uppercase dark:text-amber-400">
                  {changelog.updated.length} updated
                </span>
              ) : null}
              {changelog.removed.length > 0 ? (
                <span className="rounded-md border border-red-500/35 bg-red-500/10 px-2 py-0.5 font-mono text-[0.5rem] font-semibold tracking-[0.08em] text-red-700 uppercase dark:text-red-300">
                  {changelog.removed.length} removed
                </span>
              ) : null}
            </div>
            <ChangeSection label="Added" pages={changelog.added} tone="added" />
            <ChangeSection
              label="Updated"
              pages={changelog.updated}
              tone="updated"
            />
            <ChangeSection
              label="Removed"
              pages={changelog.removed}
              tone="removed"
            />
          </>
        ) : null}

        {!running && !changelog && status === "idle" ? (
          <p className="text-xs leading-5 text-muted">
            Run Check to compare live pages with the index, or Update to apply
            changes automatically.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function formatDownloads(value: number | null | undefined): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}

function formatPageRank(value: number | null | undefined): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  return value.toFixed(2);
}

function CatalogMetricChips({
  entry,
  rankMode,
  layout = "row",
}: {
  entry: TypescriptDocsCatalogEntry;
  rankMode: CatalogRankMode;
  layout?: "row" | "stack";
}) {
  const downloads = formatDownloads(entry.downloadsLastMonth);
  const pageRank = formatPageRank(entry.openPageRank);
  const dlActive = rankMode === "downloads";
  const oprActive = rankMode === "pagerank";

  return (
    <div
      className={cn(
        "flex shrink-0 gap-1.5",
        layout === "stack" ? "flex-col items-end" : "flex-wrap items-center",
      )}
    >
      <span
        title={
          entry.downloadsLastMonth != null
            ? `${entry.downloadsLastMonth.toLocaleString()} downloads / month`
            : "Downloads unknown"
        }
        className={cn(
          "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[0.625rem] font-semibold tabular-nums",
          dlActive
            ? "border-foreground/25 bg-foreground text-background"
            : "border-border bg-surface-alt text-foreground",
        )}
      >
        <span
          className={cn(
            "text-[0.5rem] font-semibold tracking-[0.08em] uppercase",
            dlActive ? "text-background/70" : "text-muted",
          )}
        >
          dl
        </span>
        {downloads ? `${downloads}/mo` : "—"}
      </span>
      <span
        title={
          entry.openPageRank != null
            ? `Open PageRank ${entry.openPageRank}${
                entry.docsDomain ? ` · ${entry.docsDomain}` : ""
              }`
            : "PageRank not scored"
        }
        className={cn(
          "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[0.625rem] font-semibold tabular-nums",
          oprActive
            ? "border-foreground/25 bg-foreground text-background"
            : "border-border bg-surface-alt text-foreground",
        )}
      >
        <span
          className={cn(
            "text-[0.5rem] font-semibold tracking-[0.08em] uppercase",
            oprActive ? "text-background/70" : "text-muted",
          )}
        >
          opr
        </span>
        {pageRank ?? "—"}
      </span>
    </div>
  );
}

function catalogSortValue(
  entry: TypescriptDocsCatalogEntry,
  mode: CatalogRankMode,
): number {
  if (mode === "pagerank") {
    return entry.openPageRank ?? -1;
  }
  return entry.downloadsLastMonth ?? 0;
}

function compareCatalogEntries(
  a: TypescriptDocsCatalogEntry,
  b: TypescriptDocsCatalogEntry,
  mode: CatalogRankMode,
): number {
  const diff = catalogSortValue(b, mode) - catalogSortValue(a, mode);
  if (diff !== 0) return diff;
  if (mode === "pagerank") {
    const dl = (b.downloadsLastMonth ?? 0) - (a.downloadsLastMonth ?? 0);
    if (dl !== 0) return dl;
  } else {
    const opr = (b.openPageRank ?? -1) - (a.openPageRank ?? -1);
    if (opr !== 0) return opr;
  }
  return a.package.localeCompare(b.package);
}

function categoryLabel(category: string): string {
  switch (category) {
    case "frameworks":
      return "Frameworks";
    case "libraries":
      return "Libraries";
    case "apis-services":
      return "APIs / services";
    case "tooling":
      return "Tooling";
    case "uncategorized":
      return "Uncategorized";
    default:
      return category;
  }
}

const CATALOG_CRAWL_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

function catalogDocsIdentityKind(
  category: string,
): DocsIdentityKind | undefined {
  switch (category) {
    case "frameworks":
    case "libraries":
    case "apis-services":
    case "tooling":
    case "uncategorized":
      return category;
    default:
      return undefined;
  }
}

function catalogSourceName(entry: TypescriptDocsCatalogEntry): string {
  return entry.package;
}

/** Open the normal Add source flow, prefilled with this package's docs URL. */
function catalogWebCrawlHref(
  entry: TypescriptDocsCatalogEntry,
  scope: KnowledgeSetScope,
): string | null {
  const docsUrl = effectiveCatalogDocsUrl(entry);
  if (!docsUrl) return null;
  const params = new URLSearchParams({
    url: docsUrl,
  });
  if (scope === "global") params.set("scope", "global");
  if (entry.excludePatterns.length > 0) {
    params.set("excludes", entry.excludePatterns.join("\n"));
  }
  if (entry.patternsAreRegex) {
    params.set("patternsAreRegex", "1");
  }
  return `/sources/web-crawl?${params.toString()}`;
}

/**
 * Package name opens Add source (new tab on web, in-app on desktop).
 * Electron denies target=_blank into a useful window — navigate instead.
 */
function CatalogPackageName({
  name,
  href,
  className,
}: {
  name: string;
  href: string | null;
  className?: string;
}) {
  const router = useRouter();
  const isDesktop = Boolean(getLedgeIndexDesktop());

  if (!href) {
    return <p className={className}>{name}</p>;
  }

  return (
    <a
      href={href}
      target={isDesktop ? undefined : "_blank"}
      rel={isDesktop ? undefined : "noreferrer"}
      className={cn(className, "hover:text-accent hover:underline")}
      title={
        isDesktop
          ? "Open Add source with this docs URL"
          : "Open Add source in a new tab with this docs URL"
      }
      onClick={(event) => {
        event.stopPropagation();
        if (!isDesktop) return;
        event.preventDefault();
        router.push(href);
      }}
    >
      {name}
    </a>
  );
}

function catalogCrawlConfig(startUrls: string[], entry: TypescriptDocsCatalogEntry): WebCrawlConfig {
  return {
    startUrls,
    includePatterns: [],
    excludePatterns: [...entry.excludePatterns],
    excludeDownloadPatterns: [],
    patternsAreRegex: Boolean(entry.patternsAreRegex),
    renderJs: false,
    useProxy: false,
    enableSitemap: true,
    sitemapOnly: false,
    sitemapUrls: [],
    fileTypes: ["html"],
    contentSelectors: ["article", "main", ".content", ".documentation"],
    excludeSelectors: ["nav", "footer", ".sidebar", ".toc", ".navigation"],
    maxPages: 1000,
    userAgent: CATALOG_CRAWL_USER_AGENT,
  };
}

function catalogSourceMetadata(
  entry: TypescriptDocsCatalogEntry,
): SourceMetadata {
  const kind = catalogDocsIdentityKind(entry.category);
  return {
    sourceType: "documentation",
    sourceTypeConfidence: 1,
    origin: "external",
    version: entry.selectedVersion || "latest",
    versionSource: "user",
    detectedSignals: ["typescript-docs-catalog", `npm:${entry.package}`],
    docsIdentity: {
      overallSummary: entry.description ?? undefined,
      kind,
      language: "typescript",
      paths: [],
    },
  };
}

function catalogRowStatusLabel(status: RowStatus): string {
  switch (status) {
    case "queued":
      return "queued";
    case "running":
      return "updating";
    case "updated":
      return "done";
    case "up-to-date":
      return "exists";
    case "error":
      return "error";
    case "cancelled":
      return "cancelled";
    default:
      return "";
  }
}

function CatalogExcludeBadge({ entry }: { entry: TypescriptDocsCatalogEntry }) {
  if (entry.excludePatterns.length === 0) return null;
  return (
    <span
      title={`Exclude:\n${entry.excludePatterns.join("\n")}${
        entry.patternsAreRegex ? "\n(regex)" : ""
      }`}
      className="inline-flex shrink-0 items-center gap-1 rounded-md border border-amber-500/35 bg-amber-500/10 px-1.5 py-0.5 font-mono text-[0.5rem] font-semibold tracking-[0.08em] text-amber-800 uppercase dark:text-amber-300"
    >
      {entry.excludePatterns.length} excl
    </span>
  );
}

function CatalogVersionsBadge({ entry }: { entry: TypescriptDocsCatalogEntry }) {
  if (entry.versions.length <= 1) return null;
  return (
    <span
      title={`Versions: ${entry.versions.join(", ")}`}
      className="inline-flex shrink-0 items-center rounded-md border border-accent/35 bg-accent/10 px-1.5 py-0.5 font-mono text-[0.5rem] font-semibold tracking-[0.08em] text-accent uppercase"
    >
      {entry.versions.length} vers
    </span>
  );
}

type CatalogPathBadge = {
  kind: string;
  url: string;
  label?: string;
  primary?: boolean;
};

function normalizePathKey(url: string): string {
  return url.replace(/\/+$/, "").toLowerCase();
}

type CatalogIndexState = {
  sourceId: string | null;
  /** Normalized catalog path URLs that appear on the matched source's startUrls. */
  indexedPathKeys: Set<string>;
  pathTotal: number;
  pageCount: number;
  chunkCount: number;
  indexedAt: string | null;
};

function sourceStartUrlKeys(source: SourceSummary): string[] {
  const urls =
    source.startUrls?.length > 0
      ? source.startUrls
      : source.startUrl
        ? [source.startUrl]
        : [];
  return urls.filter(Boolean).map(normalizePathKey);
}

/** Match existing sources → catalog packages (by name, then startUrl overlap). */
function buildCatalogIndexByPackage(
  sources: SourceSummary[],
  entries: TypescriptDocsCatalogEntry[],
): Map<string, CatalogIndexState> {
  const byName = new Map<string, SourceSummary>();
  for (const source of sources) {
    const key = source.name.trim().toLowerCase();
    if (!key) continue;
    const prev = byName.get(key);
    // Prefer the one that actually has pages indexed.
    if (!prev || (source.pageCount ?? 0) > (prev.pageCount ?? 0)) {
      byName.set(key, source);
    }
  }

  const map = new Map<string, CatalogIndexState>();
  for (const entry of entries) {
    const badges = catalogPathBadges(entry);
    const badgeKeys = badges.map((badge) => normalizePathKey(badge.url));
    const badgeKeySet = new Set(badgeKeys);

    let match = byName.get(entry.package.trim().toLowerCase()) ?? null;
    if (!match && badgeKeySet.size > 0) {
      let best: SourceSummary | null = null;
      let bestScore = 0;
      for (const source of sources) {
        let score = 0;
        for (const key of sourceStartUrlKeys(source)) {
          if (badgeKeySet.has(key)) score += 1;
        }
        if (score > bestScore) {
          bestScore = score;
          best = source;
        }
      }
      if (bestScore > 0) match = best;
    }

    const indexedPathKeys = new Set<string>();
    if (match) {
      for (const key of sourceStartUrlKeys(match)) {
        if (badgeKeySet.has(key)) indexedPathKeys.add(key);
      }
    }

    map.set(entry.package, {
      sourceId: match?.id ?? null,
      indexedPathKeys,
      pathTotal: badgeKeys.length,
      pageCount: match?.pageCount ?? 0,
      chunkCount: match?.chunkCount ?? 0,
      indexedAt: match?.indexedAt ?? null,
    });
  }
  return map;
}

/** Always includes main docs as a badge when present, then discovered paths / API refs. */
function catalogPathBadges(entry: TypescriptDocsCatalogEntry): CatalogPathBadge[] {
  const out: CatalogPathBadge[] = [];
  const seen = new Set<string>();

  if (entry.docs) {
    out.push({
      kind: "docs",
      url: entry.docs,
      label: "main",
      primary: true,
    });
    seen.add(normalizePathKey(entry.docs));
  }

  for (const path of entry.paths) {
    const key = normalizePathKey(path.url);
    if (!path.url || seen.has(key)) continue;
    seen.add(key);
    out.push({
      kind: path.kind,
      url: path.url,
      label: path.label,
    });
  }

  for (const url of entry.apiReferenceUrls) {
    const key = normalizePathKey(url);
    if (!url || seen.has(key)) continue;
    seen.add(key);
    out.push({ kind: "api", url });
  }

  return out;
}

function CatalogPathBadges({
  entry,
  compact = false,
  selectedUrls,
  onToggleUrl,
  allowDeselectMain = false,
  indexedUrls,
}: {
  entry: TypescriptDocsCatalogEntry;
  compact?: boolean;
  /** When set, badges become selectable. Main stays locked unless allowDeselectMain. */
  selectedUrls?: Set<string> | null;
  onToggleUrl?: (url: string, next: boolean) => void;
  /** When true (paths-only crawl), main docs can be unchecked. */
  allowDeselectMain?: boolean;
  /** Normalized (or raw) start URLs already on an indexed source. */
  indexedUrls?: Set<string> | null;
}) {
  const badges = catalogPathBadges(entry);
  if (badges.length === 0) return null;
  const selectable = Boolean(selectedUrls && onToggleUrl);

  function isIndexed(url: string): boolean {
    if (!indexedUrls || indexedUrls.size === 0) return false;
    const key = normalizePathKey(url);
    if (indexedUrls.has(key)) return true;
    return [...indexedUrls].some(
      (value) => normalizePathKey(value) === key,
    );
  }

  return (
    <div className={cn("flex flex-wrap gap-1", compact ? "mt-1" : "mt-0.5")}>
      {badges.map((badge) => {
        const key = normalizePathKey(badge.url);
        const lockedMain = Boolean(badge.primary && !allowDeselectMain);
        const checked = lockedMain
          ? true
          : selectedUrls
            ? [...selectedUrls].some((url) => normalizePathKey(url) === key)
            : false;
        const indexed = isIndexed(badge.url);

        if (selectable) {
          return (
            <div
              key={`${badge.kind}:${badge.url}`}
              className={cn(
                "inline-flex max-w-full items-center gap-1.5 truncate rounded-md border px-1.5 py-0.5 font-mono text-[0.5rem] font-semibold transition-colors",
                indexed
                  ? "border-emerald-500/35 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300"
                  : badge.primary || checked
                    ? "border-accent/40 bg-accent/10 text-accent"
                    : "border-border bg-surface-alt text-muted hover:border-border/80 hover:text-foreground",
                compact && "gap-1",
              )}
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => event.stopPropagation()}
            >
              <input
                type="checkbox"
                className="size-3 shrink-0 cursor-pointer"
                checked={checked}
                disabled={lockedMain}
                onChange={(event) => {
                  if (lockedMain) return;
                  onToggleUrl?.(badge.url, event.target.checked);
                }}
                onClick={(event) => event.stopPropagation()}
                aria-label={`Include ${badge.kind} path ${badge.label || badge.url}`}
                title={
                  lockedMain
                    ? "Main docs path is always included"
                    : "Include this path in the update"
                }
              />
              <a
                href={badge.url}
                target="_blank"
                rel="noreferrer"
                title={badge.url}
                className="inline-flex min-w-0 items-center gap-1 truncate hover:underline"
                onClick={(event) => event.stopPropagation()}
              >
                <span className="shrink-0 tracking-[0.06em] uppercase">
                  {badge.kind}
                  {!compact && badge.primary ? " · main" : ""}
                </span>
                <span className="min-w-0 truncate normal-case tracking-normal opacity-80">
                  {compact
                    ? formatStartPathLabel(badge.url)
                    : badge.label || formatStartPathLabel(badge.url)}
                </span>
                <span className="shrink-0 opacity-70" aria-hidden>
                  ↗
                </span>
              </a>
            </div>
          );
        }

        return (
          <a
            key={`${badge.kind}:${badge.url}`}
            href={badge.url}
            target="_blank"
            rel="noreferrer"
            title={
              indexed
                ? `${badge.url} · already indexed`
                : badge.url
            }
            className={cn(
              "inline-flex max-w-full items-center gap-1 truncate rounded-md border px-1.5 py-0.5 font-mono text-[0.5rem] font-semibold transition-colors hover:border-accent/50",
              indexed
                ? "border-emerald-500/35 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300"
                : badge.primary
                  ? "border-accent/40 bg-accent/10 text-accent"
                  : "border-border bg-surface-alt text-muted hover:text-foreground",
            )}
          >
            <span className="shrink-0 tracking-[0.06em] uppercase">
              {badge.kind}
            </span>
            <span className="min-w-0 truncate normal-case tracking-normal opacity-80">
              {compact
                ? formatStartPathLabel(badge.url)
                : badge.label || formatStartPathLabel(badge.url)}
            </span>
          </a>
        );
      })}
    </div>
  );
}

function CatalogDetailPanel({
  entry,
  rankMode,
  displayRank,
  selectedUrls,
  onToggleUrl,
  allowDeselectMain = false,
  canPersistPaths,
  onPathsSaved,
  indexState,
  scope,
}: {
  entry: TypescriptDocsCatalogEntry | null;
  rankMode: CatalogRankMode;
  displayRank: number | null;
  selectedUrls?: Set<string> | null;
  onToggleUrl?: (url: string, next: boolean) => void;
  allowDeselectMain?: boolean;
  canPersistPaths: boolean;
  onPathsSaved: (next: TypescriptDocsCatalogEntry) => void;
  indexState?: CatalogIndexState;
  scope: KnowledgeSetScope;
}) {
  if (!entry) {
    return (
      <div className="flex h-full min-h-0 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card-solid/60 px-4 text-center">
        <p className="text-sm font-medium text-foreground">Catalog details</p>
        <p className="mt-1 max-w-[16rem] text-xs leading-5 text-muted">
          Pick a package on the left to review paths, approve or edit the JSON
          starting list, and inspect failed / missing / uncertain results.
        </p>
      </div>
    );
  }

  const pathBadges = catalogPathBadges(entry);
  const optionalCount = pathBadges.filter((badge) => !badge.primary).length;
  const homepage =
    entry.homepage &&
    entry.homepage.replace(/\/+$/, "").toLowerCase() !==
      (entry.docs ?? "").replace(/\/+$/, "").toLowerCase()
      ? entry.homepage
      : null;
  const configureHref = catalogWebCrawlHref(entry, scope);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto overscroll-contain rounded-xl border border-border bg-card-solid p-4">
      <div className="shrink-0">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CatalogPackageName
              name={entry.package}
              href={configureHref}
              className="text-sm font-semibold text-foreground"
            />
            <p className="mt-0.5 text-xs text-muted">
              {categoryLabel(entry.category)}
              {displayRank != null ? ` · #${displayRank}` : ""}
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1.5">
            <CatalogMetricChips entry={entry} rankMode={rankMode} layout="stack" />
          </div>
        </div>
        {entry.description ? (
          <p className="mt-2 text-xs leading-5 text-muted-strong">
            {entry.description}
          </p>
        ) : null}
      </div>

      <section className="space-y-2 rounded-lg border border-border bg-surface-alt/60 p-2.5">
        <div className="space-y-0.5">
          <p className="font-mono text-[0.5rem] font-semibold tracking-[0.12em] text-muted uppercase">
            Docs · start URL
          </p>
          {entry.docs ? (
            <a
              href={entry.docs}
              target="_blank"
              rel="noreferrer"
              className="block break-all font-mono text-[0.625rem] leading-4 text-foreground hover:text-accent hover:underline"
            >
              {entry.docs}
            </a>
          ) : (
            <p className="text-xs text-muted">No docs URL yet</p>
          )}
          {entry.docsStatus || entry.pathsStatus ? (
            <p className="font-mono text-[0.5rem] text-muted">
              {entry.docsStatus ? `docs: ${entry.docsStatus}` : null}
              {entry.docsStatus && entry.pathsStatus ? " · " : null}
              {entry.pathsStatus ? `paths: ${entry.pathsStatus}` : "paths: missing"}
            </p>
          ) : null}
        </div>
        <div className="space-y-0.5 border-t border-border/70 pt-2">
          <p className="font-mono text-[0.5rem] font-semibold tracking-[0.12em] text-muted uppercase">
            Homepage
          </p>
          {homepage ? (
            <a
              href={homepage}
              target="_blank"
              rel="noreferrer"
              className="block break-all font-mono text-[0.625rem] leading-4 text-muted-strong hover:text-accent hover:underline"
            >
              {homepage}
            </a>
          ) : (
            <p className="text-[0.625rem] text-muted">
              {entry.homepage
                ? "Same as docs URL"
                : "No separate homepage"}
            </p>
          )}
        </div>
      </section>

      <CatalogPathsMaintainPanel
        entry={entry}
        canPersist={canPersistPaths}
        onSaved={onPathsSaved}
      />

      <section className="space-y-1.5">
        <p className="font-mono text-[0.5625rem] font-semibold tracking-[0.12em] text-muted uppercase">
          Update paths
        </p>
        <p className="text-[0.625rem] leading-4 text-muted">
          {allowDeselectMain
            ? "Paths-only: nothing pre-selected — tick the path(s) to update (main optional). Package must already exist from a prior full update."
            : "When adding sets from Top N, main docs is always included. Tick optional paths to include them too"}
          {optionalCount > 0 ? ` · ${optionalCount} optional` : ""}.
        </p>
        {pathBadges.length > 0 ? (
          <CatalogPathBadges
            entry={entry}
            selectedUrls={selectedUrls ?? null}
            onToggleUrl={onToggleUrl}
            allowDeselectMain={allowDeselectMain}
            indexedUrls={indexState?.indexedPathKeys ?? null}
          />
        ) : (
          <p className="text-xs text-muted">
            No docs URL yet — verify first, then discover or add paths manually.
          </p>
        )}
      </section>

      <section className="space-y-1">
        <p className="font-mono text-[0.5625rem] font-semibold tracking-[0.12em] text-muted uppercase">
          Versions
        </p>
        <div className="flex flex-wrap gap-1">
          {entry.versions.map((version) => (
            <span
              key={version}
              className={cn(
                "rounded-md border px-1.5 py-0.5 font-mono text-[0.5625rem] font-semibold",
                version === entry.selectedVersion
                  ? "border-accent/40 bg-accent/10 text-accent"
                  : "border-border bg-surface-alt text-muted",
              )}
            >
              {version}
            </span>
          ))}
        </div>
        <p className="text-[0.625rem] text-muted">
          Default update target: {entry.selectedVersion}
          {entry.versions.length === 1
            ? " (only latest tree detected)"
            : " (multi-version site)"}
        </p>
      </section>

      <section className="space-y-1">
        <p className="font-mono text-[0.5625rem] font-semibold tracking-[0.12em] text-muted uppercase">
          Exclude patterns
          {entry.patternsAreRegex ? " · regex" : ""}
        </p>
        {entry.excludePatterns.length === 0 ? (
          <p className="text-xs text-muted">
            None yet — fill via exclude-pattern script, then updates skip
            unwanted trees.
          </p>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-background">
            {entry.excludePatterns.map((pattern) => (
              <li
                key={pattern}
                className="px-2.5 py-1.5 font-mono text-[0.6875rem] text-foreground"
              >
                {pattern}
              </li>
            ))}
          </ul>
        )}
      </section>

      {entry.github ? (
        <section className="space-y-1 border-t border-border pt-3">
          <p className="truncate font-mono text-[0.625rem] text-muted">
            github: {entry.github}
          </p>
        </section>
      ) : null}
    </div>
  );
}

export default function AdminSourceUpdaterPage() {
  const { isAdmin } = useAuth();
  const hostingCaps = useHostingCapabilities();
  const [tab, setTab] = useState<UpdaterTab>("sources");
  const [scope, setScope] = useState<KnowledgeSetScope>("personal");
  const [storageFilter, setStorageFilter] = useState<StorageFilter>("all");
  const [sources, setSources] = useState<SourceSummary[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [rowStatus, setRowStatus] = useState<Record<string, RowStatus>>({});
  const [rowError, setRowError] = useState<Record<string, string>>({});
  const [changelogs, setChangelogs] = useState<
    Record<string, RefreshChangelog>
  >({});
  const [runReports, setRunReports] = useState<Record<string, SourceRunReport>>(
    {},
  );
  const [focusSourceId, setFocusSourceId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [runningMode, setRunningMode] = useState<
    "refresh" | "check" | "catalog-crawl"
  >("refresh");
  const [panelActionBusy, setPanelActionBusy] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [currentSourceId, setCurrentSourceId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<RefreshRunSnapshot | null>(null);
  const [catalogIngestSnapshot, setCatalogIngestSnapshot] =
    useState<IngestPipelineSnapshot | null>(null);
  const [catalogCrawlPages, setCatalogCrawlPages] = useState<number | null>(
    null,
  );
  const [queueIndex, setQueueIndex] = useState(0);
  const [queueTotal, setQueueTotal] = useState(0);
  const [lastRunIds, setLastRunIds] = useState<string[]>([]);
  const abortRef = useRef(false);
  const currentSourceIdRef = useRef<string | null>(null);
  const catalogIngestRunIdRef = useRef<string | null>(null);
  const catalogPollStopRef = useRef<(() => void) | null>(null);

  const [catalog, setCatalog] = useState<TypescriptDocsCatalog | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogQuery, setCatalogQuery] = useState("");
  const [catalogCategory, setCatalogCategory] =
    useState<CatalogCategoryFilter>("all");
  const [catalogRankMode, setCatalogRankMode] =
    useState<CatalogRankMode>("pagerank");
  const [focusCatalogPackage, setFocusCatalogPackage] = useState<string | null>(
    null,
  );
  const [selectedCatalog, setSelectedCatalog] = useState<Set<string>>(
    new Set(),
  );
  /** package → selected crawl path URLs (main docs always included when selected). */
  const [selectedCatalogPaths, setSelectedCatalogPaths] = useState<
    Record<string, string[]>
  >({});
  const [includeOptionalPathsAll, setIncludeOptionalPathsAll] = useState(false);
  const [catalogPathsFilter, setCatalogPathsFilter] =
    useState<CatalogPathsFilter>("all");
  const [showFailedMissingDocs, setShowFailedMissingDocs] = useState(false);
  const [catalogTop50Only, setCatalogTop50Only] = useState(true);
  const [catalogCrawlMode, setCatalogCrawlMode] =
    useState<CatalogCrawlMode>("full");
  const [catalogRowStatus, setCatalogRowStatus] = useState<
    Record<string, RowStatus>
  >({});
  const [catalogRowError, setCatalogRowError] = useState<
    Record<string, string>
  >({});
  const [catalogCrawlPackage, setCatalogCrawlPackage] = useState<string | null>(
    null,
  );
  const canPersistCatalogPaths =
    process.env.NODE_ENV === "development";

  function defaultCatalogPaths(
    entry: TypescriptDocsCatalogEntry,
    includeOptional: boolean,
  ): string[] {
    const badges = catalogPathBadges(entry);
    if (includeOptional) return badges.map((badge) => badge.url);
    const main = badges.find((badge) => badge.primary)?.url ?? entry.docs;
    return main ? [main] : [];
  }

  /** Initial path ticks when (re)selecting a package — empty in paths-only so you pick. */
  function initialCatalogPaths(entry: TypescriptDocsCatalogEntry): string[] {
    if (catalogCrawlMode === "paths-only") return [];
    return defaultCatalogPaths(entry, includeOptionalPathsAll);
  }

  function pathsSetForPackage(packageName: string): Set<string> {
    return new Set(selectedCatalogPaths[packageName] ?? []);
  }

  const load = useCallback(async (nextScope: KnowledgeSetScope) => {
    syncDesktopApiBaseForScope(nextScope);
    setSources(null);
    setError(null);
    try {
      const { sources: list } = await listSources(nextScope);
      setSources(list);
      setSelected(new Set());
      setRowStatus({});
      setRowError({});
      setChangelogs({});
      setRunReports({});
      setFocusSourceId(null);
      setLastRunIds([]);
      setStopping(false);
    } catch (err) {
      const raw =
        err instanceof Error ? err.message : "Failed to load sources";
      const cloudDown =
        /postgres|5432|ECONNREFUSED|cloud.?sql.?proxy|Public sources need|CLOUD_POSTGRES/i.test(
          raw,
        ) || /^internal server error$/i.test(raw.trim());
      setError(
        cloudDown
          ? "Public needs Cloud SQL Auth Proxy on :5432 (`cloud-sql-proxy … --port 5432`). Start it, then retry — or use Just me."
          : raw,
      );
      setSources([]);
    }
  }, []);

  const refreshSourcesList = useCallback(async () => {
    try {
      const { sources: list } = await listSources(scope);
      setSources(list);
    } catch {
      // keep the current list if refresh fails
    }
  }, [scope]);

  useEffect(() => {
    if (!isAdmin) return;
    void load(scope);
  }, [isAdmin, load, scope]);

  useEffect(() => {
    if (!isAdmin || tab !== "catalog") return;
    let cancelled = false;
    setCatalogLoading(true);
    setCatalogError(null);
    void fetch(catalogDataUrl(true), { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Failed to load catalog (${res.status})`);
        return (await res.json()) as TypescriptDocsCatalog;
      })
      .then((data) => {
        if (cancelled) return;
        const entries = (data.entries ?? []).map(normalizeCatalogEntry);
        setCatalog({ ...data, entries, count: entries.length });
        setFocusCatalogPackage((prev) => {
          if (prev && entries.some((entry) => entry.package === prev)) {
            return prev;
          }
          return entries[0]?.package ?? null;
        });
      })
      .catch((err) => {
        if (cancelled) return;
        setCatalogError(
          err instanceof Error ? err.message : "Failed to load catalog",
        );
      })
      .finally(() => {
        if (!cancelled) setCatalogLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isAdmin, tab]);

  const reloadCatalog = useCallback(async () => {
    setCatalogLoading(true);
    setCatalogError(null);
    try {
      const res = await fetch(catalogDataUrl(true), { cache: "no-store" });
      if (!res.ok) throw new Error(`Catalog HTTP ${res.status}`);
      const data = (await res.json()) as TypescriptDocsCatalog;
      const entries = (data.entries ?? []).map(normalizeCatalogEntry);
      setCatalog({ ...data, entries, count: entries.length });
    } catch (err) {
      setCatalogError(
        err instanceof Error ? err.message : "Failed to reload catalog",
      );
    } finally {
      setCatalogLoading(false);
    }
  }, []);

  function applySavedCatalogEntry(saved: TypescriptDocsCatalogEntry) {
    const normalized = normalizeCatalogEntry(saved);
    setCatalog((prev) => {
      if (!prev) return prev;
      const exists = prev.entries.some(
        (entry) => entry.package === normalized.package,
      );
      const entries = exists
        ? prev.entries.map((entry) =>
            entry.package === normalized.package ? normalized : entry,
          )
        : [...prev.entries, normalized];
      return { ...prev, entries, count: entries.length };
    });
    setFocusCatalogPackage(normalized.package);
    void reloadCatalog();
  }

  const catalogUsableEntries = useMemo(() => {
    if (!catalog) return [];
    return catalog.entries.filter(isCatalogEntryCrawlReady);
  }, [catalog]);

  const catalogReviewEntries = useMemo(() => {
    if (!catalog) return [];
    if (!showFailedMissingDocs) return catalogUsableEntries;
    return catalog.entries.filter((entry) => {
      if (isCatalogEntryCrawlReady(entry)) return true;
      const docsStatus = (entry.docsStatus || "").toLowerCase();
      return (
        docsStatus === "uncertain" ||
        docsStatus === "rejected" ||
        docsStatus === "failed" ||
        !entry.docs
      );
    });
  }, [catalog, catalogUsableEntries, showFailedMissingDocs]);

  const catalogEntries = useMemo(() => {
    const q = catalogQuery.trim().toLowerCase();
    return catalogReviewEntries
      .filter((entry) => {
        if (catalogTop50Only && !isCuratedTopDocsPackage(entry.package)) {
          return false;
        }
        if (catalogCategory !== "all" && entry.category !== catalogCategory) {
          return false;
        }
        if (!matchesCatalogPathsFilter(entry, catalogPathsFilter)) {
          return false;
        }
        if (!q) return true;
        return (
          entry.package.toLowerCase().includes(q) ||
          (entry.docs ?? "").toLowerCase().includes(q) ||
          (entry.description ?? "").toLowerCase().includes(q) ||
          (entry.github ?? "").toLowerCase().includes(q) ||
          (entry.pathsStatus ?? "").toLowerCase().includes(q)
        );
      })
      .sort((a, b) =>
        catalogTop50Only
          ? compareCuratedTopDocs(a, b)
          : compareCatalogEntries(a, b, catalogRankMode),
      );
  }, [
    catalogReviewEntries,
    catalogCategory,
    catalogPathsFilter,
    catalogQuery,
    catalogRankMode,
    catalogTop50Only,
  ]);

  const catalogIndexByPackage = useMemo(() => {
    if (!sources || !catalog) return new Map<string, CatalogIndexState>();
    return buildCatalogIndexByPackage(sources, catalog.entries);
  }, [sources, catalog]);

  const catalogTop50PresentCount = useMemo(() => {
    if (!catalog) return 0;
    return catalog.entries.filter((entry) =>
      isCuratedTopDocsPackage(entry.package),
    ).length;
  }, [catalog]);

  const catalogDisplayRankByPackage = useMemo(() => {
    const map = new Map<string, number>();
    catalogEntries.forEach((entry, index) => {
      map.set(entry.package, index + 1);
    });
    return map;
  }, [catalogEntries]);

  const focusCatalogEntry = useMemo(() => {
    if (!focusCatalogPackage) return null;
    return (
      catalogEntries.find((entry) => entry.package === focusCatalogPackage) ??
      catalogReviewEntries.find(
        (entry) => entry.package === focusCatalogPackage,
      ) ??
      catalog?.entries.find((entry) => entry.package === focusCatalogPackage) ??
      null
    );
  }, [catalog, catalogEntries, catalogReviewEntries, focusCatalogPackage]);

  const catalogReadyCount = catalogUsableEntries.length;

  const catalogPathsFilterCounts = useMemo(() => {
    const counts: Record<CatalogPathsFilter, number> = {
      all: 0,
      discovered: 0,
      uncertain: 0,
      missing: 0,
      failed: 0,
    };
    for (const entry of catalogReviewEntries) {
      counts.all += 1;
      counts[catalogPathsBucket(entry)] += 1;
    }
    return counts;
  }, [catalogReviewEntries]);

  const catalogCategoryCounts = useMemo(() => {
    const counts: Record<CatalogCategoryFilter, number> = {
      all: 0,
      frameworks: 0,
      libraries: 0,
      "apis-services": 0,
      tooling: 0,
      uncategorized: 0,
    };
    counts.all = catalogReviewEntries.length;
    for (const entry of catalogReviewEntries) {
      const key = entry.category as CatalogCategoryFilter;
      if (key in counts && key !== "all") counts[key] += 1;
    }
    return counts;
  }, [catalogReviewEntries]);

  const activeFocusId = currentSourceId ?? focusSourceId;

  const storageCounts = useMemo(() => {
    const list = sources ?? [];
    let local = 0;
    let cloud = 0;
    for (const source of list) {
      if (resolveSourceStorage(source) === "cloud") cloud += 1;
      else local += 1;
    }
    return { all: list.length, local, cloud };
  }, [sources]);

  const filteredSources = useMemo(() => {
    if (!sources) return null;
    if (storageFilter === "all") return sources;
    return sources.filter(
      (source) => resolveSourceStorage(source) === storageFilter,
    );
  }, [sources, storageFilter]);

  const focusSource = useMemo(
    () =>
      filteredSources?.find((source) => source.id === activeFocusId) ??
      sources?.find((source) => source.id === activeFocusId) ??
      null,
    [activeFocusId, filteredSources, sources],
  );

  const focusChangelog = useMemo(() => {
    if (
      snapshot?.sourceId === activeFocusId &&
      snapshot.changelog &&
      snapshot.status === "ready"
    ) {
      return normalizeStoredChangelog(snapshot.changelog);
    }
    if (snapshot?.sourceId === activeFocusId && snapshot.changelog) {
      const inProgress =
        snapshot.status === "discovering" ||
        snapshot.status === "parsing" ||
        snapshot.status === "comparing" ||
        snapshot.status === "applying";
      if (inProgress || changelogHasDiff(snapshot.changelog)) {
        return normalizeStoredChangelog(snapshot.changelog);
      }
    }
    if (activeFocusId) {
      const saved = runReports[activeFocusId];
      if (saved && changelogHasDiff(saved.changelog)) {
        return normalizeStoredChangelog(saved.changelog);
      }
      const pending = changelogs[activeFocusId];
      if (pending && changelogHasDiff(pending)) {
        return normalizeStoredChangelog(pending);
      }
      if (saved) return normalizeStoredChangelog(saved.changelog);
      if (pending) return normalizeStoredChangelog(pending);
    }
    return null;
  }, [activeFocusId, changelogs, runReports, snapshot]);

  const focusReportMeta = useMemo((): SourceRunReportMeta | null => {
    if (!activeFocusId) return null;
    const saved = runReports[activeFocusId];
    const status = rowStatus[activeFocusId] ?? saved?.status ?? "idle";

    if (
      saved &&
      (status === "updated" ||
        status === "up-to-date" ||
        status === "changes-found" ||
        status === "error" ||
        status === "cancelled")
    ) {
      return {
        mode: saved.mode,
        finishedAt: saved.finishedAt,
        fromSaved: status !== "changes-found",
      };
    }

    if (
      running &&
      snapshot?.sourceId === activeFocusId &&
      (snapshot.status === "discovering" ||
        snapshot.status === "parsing" ||
        snapshot.status === "comparing" ||
        snapshot.status === "applying")
    ) {
      return {
        mode: runningMode === "check" ? "check" : "update",
        finishedAt: Date.now(),
        fromSaved: false,
      };
    }

    return null;
  }, [activeFocusId, runReports, rowStatus, running, runningMode, snapshot]);

  const pipeline = useMemo(() => {
    const refreshPipelineActive =
      (running && runningMode !== "catalog-crawl") || panelActionBusy;
    if (!refreshPipelineActive && !running) {
      return IDLE_INGEST_PIPELINE.map((node) => ({ ...node }));
    }
    if (running && runningMode === "catalog-crawl") {
      return pipelineFromCatalogIngest({
        snapshot: catalogIngestSnapshot,
        crawlPages: catalogCrawlPages,
        maxPages: 1000,
      });
    }
    return pipelineFromRefreshSnapshot(snapshot, {
      checkOnly: runningMode === "check",
    });
  }, [
    running,
    runningMode,
    panelActionBusy,
    catalogIngestSnapshot,
    catalogCrawlPages,
    snapshot,
  ]);

  const headline = useMemo(() => {
    if (tab === "catalog") {
      if (running && runningMode === "catalog-crawl") {
        const pkgBit = catalogCrawlPackage
          ? `${catalogCrawlPackage} · ${queueIndex + 1} / ${queueTotal}`
          : `${queueIndex + 1} / ${queueTotal}`;
        const runningNode = pipeline.find((node) => node.status === "running");
        if (
          runningNode?.id === "crawl" &&
          typeof catalogCrawlPages === "number"
        ) {
          return `Updating ${pkgBit} · ${catalogCrawlPages} pages`;
        }
        if (runningNode?.detail) {
          return `${runningNode.label}: ${runningNode.detail} · ${pkgBit}`;
        }
        if (runningNode) {
          return `${runningNode.label} · ${pkgBit}`;
        }
        return `Updating ${pkgBit}`;
      }
      if (selectedCatalog.size === 0) {
        return catalogCrawlMode === "paths-only"
          ? "Paths-only: select a package, then tick path(s) to update"
          : "Select packages to update";
      }
      const pathCount = [...selectedCatalog].reduce((sum, pkg) => {
        return sum + (selectedCatalogPaths[pkg]?.length ?? 0);
      }, 0);
      if (catalogCrawlMode === "paths-only") {
        return pathCount === 0
          ? `${selectedCatalog.size} selected · tick path(s) to update (main not forced)`
          : `${selectedCatalog.size} selected — ready to update (${pathCount} path${pathCount === 1 ? "" : "s"})`;
      }
      return includeOptionalPathsAll
        ? `${selectedCatalog.size} selected — ready to update · ${pathCount || selectedCatalog.size} paths`
        : `${selectedCatalog.size} selected — ready to update`;
    }
    if (!running) {
      return selected.size > 0
        ? `${selected.size} selected — check or update`
        : "Select sources to check or update";
    }
    if (runningMode === "check") {
      const pathBit =
        snapshot?.activePath &&
        snapshot.pathTotal &&
        snapshot.pathTotal > 1
          ? ` · ${snapshot.activePath} (${snapshot.pathIndex}/${snapshot.pathTotal})`
          : "";
      if (snapshot?.status === "ready") {
        return focusSource
          ? `${focusSource.name} — compared${pathBit}`
          : `Compared ${queueIndex + 1} / ${queueTotal}${pathBit}`;
      }
      if (!focusSource) {
        return `Checking ${queueIndex + 1} / ${queueTotal}${pathBit}`;
      }
      return `Checking ${focusSource.name} · ${queueIndex + 1} / ${queueTotal}${pathBit}`;
    }
    const pathBit =
      snapshot?.activePath &&
      snapshot.pathTotal &&
      snapshot.pathTotal > 1
        ? ` · ${snapshot.activePath} (${snapshot.pathIndex}/${snapshot.pathTotal})`
        : "";
    const progressBit =
      snapshot &&
      snapshot.total > 0 &&
      (snapshot.status === "applying" || snapshot.status === "parsing")
        ? ` · ${snapshot.current}/${snapshot.total}`
        : "";
    const queueBit =
      queueTotal > 1 ? ` · ${queueIndex + 1} / ${queueTotal}` : "";
    if (!focusSource) {
      return `Updating${queueBit}${pathBit}${progressBit}`;
    }
    return `${focusSource.name}${queueBit}${pathBit}${progressBit}`;
  }, [
    catalogCrawlMode,
    catalogCrawlPackage,
    catalogCrawlPages,
    focusSource,
    pipeline,
    queueIndex,
    queueTotal,
    running,
    runningMode,
    selected.size,
    selectedCatalog.size,
    selectedCatalogPaths,
    includeOptionalPathsAll,
    snapshot?.activePath,
    snapshot?.pathIndex,
    snapshot?.pathTotal,
    snapshot?.current,
    snapshot?.total,
    snapshot?.status,
    tab,
  ]);

  const catalogSelectedPathCount = useMemo(() => {
    return [...selectedCatalog].reduce((sum, pkg) => {
      return sum + (selectedCatalogPaths[pkg]?.length ?? 0);
    }, 0);
  }, [selectedCatalog, selectedCatalogPaths]);

  function rememberChangelog(
    sourceId: string,
    next: RefreshRunSnapshot | null | undefined,
  ) {
    if (!next?.changelog) return;
    const incoming = next.changelog;
    const hasIncomingDiff = changelogHasDiff(incoming);

    setChangelogs((prev) => {
      const existing = prev[sourceId];
      if (
        next.status === "done" &&
        !hasIncomingDiff &&
        changelogHasDiff(existing)
      ) {
        return prev;
      }
      return {
        ...prev,
        [sourceId]: normalizeStoredChangelog(incoming),
      };
    });
  }

  function saveRunReport(
    sourceId: string,
    changelog: RefreshChangelog | null | undefined,
    status: RowStatus,
    mode: SourceRunMode,
  ) {
    if (!changelog) return;
    const normalized = normalizeStoredChangelog(changelog);
    setRunReports((prev) => ({
      ...prev,
      [sourceId]: {
        changelog: cloneChangelog(normalized),
        status,
        mode,
        finishedAt: Date.now(),
      },
    }));
  }

  function handleScopeChange(next: KnowledgeSetScope) {
    if (running) return;
    setScope(next);
    setStorageFilter("all");
  }

  function toggle(id: string) {
    if (running) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setFocusSourceId(id);
  }

  function toggleAll() {
    if (running || !filteredSources) return;
    const visibleIds = filteredSources.map((source) => source.id);
    const allVisibleSelected =
      visibleIds.length > 0 &&
      visibleIds.every((id) => selected.has(id));
    if (allVisibleSelected) {
      setSelected((prev) => {
        const next = new Set(prev);
        for (const id of visibleIds) next.delete(id);
        return next;
      });
      return;
    }
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of visibleIds) next.add(id);
      return next;
    });
  }

  function toggleCatalog(packageName: string) {
    const entry =
      catalog?.entries.find((row) => row.package === packageName) ?? null;
    setSelectedCatalog((prev) => {
      const next = new Set(prev);
      if (next.has(packageName)) {
        next.delete(packageName);
        setSelectedCatalogPaths((pathsPrev) => {
          const copy = { ...pathsPrev };
          delete copy[packageName];
          return copy;
        });
      } else {
        next.add(packageName);
        if (entry) {
          setSelectedCatalogPaths((pathsPrev) => ({
            ...pathsPrev,
            [packageName]: initialCatalogPaths(entry),
          }));
        }
      }
      return next;
    });
    setFocusCatalogPackage(packageName);
  }

  function toggleAllCatalog() {
    if (catalogEntries.length === 0) return;
    const visiblePackages = catalogEntries.map((entry) => entry.package);
    const allVisibleSelected = visiblePackages.every((pkg) =>
      selectedCatalog.has(pkg),
    );
    if (allVisibleSelected) {
      setSelectedCatalog((prev) => {
        const next = new Set(prev);
        for (const pkg of visiblePackages) next.delete(pkg);
        return next;
      });
      setSelectedCatalogPaths((prev) => {
        const next = { ...prev };
        for (const pkg of visiblePackages) delete next[pkg];
        return next;
      });
      return;
    }
    setSelectedCatalog((prev) => {
      const next = new Set(prev);
      for (const pkg of visiblePackages) next.add(pkg);
      return next;
    });
    setSelectedCatalogPaths((prev) => {
      const next = { ...prev };
      for (const entry of catalogEntries) {
        next[entry.package] = initialCatalogPaths(entry);
      }
      return next;
    });
  }

  function setIncludeOptionalPaths(next: boolean) {
    setIncludeOptionalPathsAll(next);
    setSelectedCatalogPaths((prev) => {
      const updated = { ...prev };
      for (const pkg of selectedCatalog) {
        const entry = catalog?.entries.find((row) => row.package === pkg);
        if (!entry) continue;
        updated[pkg] = defaultCatalogPaths(entry, next);
      }
      return updated;
    });
  }

  function toggleCatalogPath(packageName: string, url: string, enabled: boolean) {
    const entry = catalog?.entries.find((row) => row.package === packageName);
    if (!entry?.docs) return;
    const mainKey = normalizePathKey(entry.docs);
    const isMain = normalizePathKey(url) === mainKey;
    if (isMain && catalogCrawlMode !== "paths-only") return;

    setSelectedCatalog((prev) => {
      if (prev.has(packageName)) return prev;
      const next = new Set(prev);
      next.add(packageName);
      return next;
    });

    setSelectedCatalogPaths((prev) => {
      const current = new Set(
        prev[packageName] ??
          (catalogCrawlMode === "paths-only"
            ? []
            : defaultCatalogPaths(entry, false)),
      );
      if (enabled) current.add(url);
      else current.delete(url);
      // Keep main unless paths-only mode explicitly allows removing it.
      if (catalogCrawlMode !== "paths-only" && entry.docs) {
        current.add(entry.docs);
      }
      return { ...prev, [packageName]: [...current] };
    });
  }

  async function pollUntilSettled(
    sourceId: string,
    isSettled: (snap: RefreshRunSnapshot) => boolean,
  ): Promise<RefreshRunSnapshot> {
    for (;;) {
      if (abortRef.current) {
        throw new Error("Cancelled");
      }
      const { snapshot: next } = await getSourceRefreshStatus(sourceId);
      if (next) {
        setSnapshot(next);
        rememberChangelog(sourceId, next);
        if (
          isSettled(next) ||
          next.status === "failed" ||
          next.status === "cancelled"
        ) {
          return next;
        }
      }
      await sleep(POLL_MS);
    }
  }

  async function checkOne(sourceId: string): Promise<RowStatus> {
    setCurrentSourceId(sourceId);
    currentSourceIdRef.current = sourceId;
    setFocusSourceId(sourceId);
    setSnapshot(null);
    setRowStatus((prev) => ({ ...prev, [sourceId]: "checking" }));

    const { snapshot: started } = await startSourceRefreshCheck(
      sourceId,
      "discover",
    );
    setSnapshot(started);
    rememberChangelog(sourceId, started);

    const ready = await pollUntilSettled(
      sourceId,
      (snap) => snap.status === "ready" || snap.status === "done",
    );

    if (ready.status === "failed") {
      throw new Error(ready.error || "Refresh check failed");
    }
    if (ready.status === "cancelled") {
      return "cancelled";
    }
    if (ready.status === "done") {
      saveRunReport(sourceId, ready.changelog, "up-to-date", "check");
      return "up-to-date";
    }

    if (!refreshHasChanges(ready)) {
      rememberChangelog(sourceId, ready);
      saveRunReport(sourceId, ready.changelog, "up-to-date", "check");
      await dismissSourceRefresh(sourceId).catch(() => undefined);
      return "up-to-date";
    }

    rememberChangelog(sourceId, ready);
    saveRunReport(sourceId, ready.changelog, "changes-found", "check");
    return "changes-found";
  }

  async function applyOne(sourceId: string): Promise<RowStatus> {
    setCurrentSourceId(sourceId);
    currentSourceIdRef.current = sourceId;
    setFocusSourceId(sourceId);
    setRowStatus((prev) => ({ ...prev, [sourceId]: "running" }));

    const { snapshot: applying } = await applySourceRefresh(sourceId);
    setSnapshot(applying);
    rememberChangelog(sourceId, applying);
    const reportChangelog = applying.changelog;

    const finished = await pollUntilSettled(
      sourceId,
      (snap) => snap.status === "done",
    );
    if (finished.status === "failed") {
      throw new Error(finished.error || "Apply failed");
    }
    if (finished.status === "cancelled") {
      return "cancelled";
    }
    saveRunReport(sourceId, reportChangelog, "updated", "update");
    return "updated";
  }

  async function startCheckQueue() {
    if (running || selected.size === 0 || !sources) return;
    const queue = sources
      .filter((source) => selected.has(source.id))
      .map((s) => s.id);
    if (queue.length === 0) return;

    abortRef.current = false;
    setRunning(true);
    setRunningMode("check");
    setStopping(false);
    setError(null);
    setQueueTotal(queue.length);
    setQueueIndex(0);
    setLastRunIds(queue);
    setFocusSourceId(queue[0] ?? null);
    setRowError({});
    setRowStatus((prev) => {
      const next = { ...prev };
      for (const id of queue) next[id] = "queued";
      return next;
    });

    syncDesktopApiBaseForScope(scope);

    let lastCompletedId: string | null = null;

    for (let i = 0; i < queue.length; i += 1) {
      if (abortRef.current) {
        setRowStatus((prev) => {
          const next = { ...prev };
          for (let j = i; j < queue.length; j += 1) {
            const id = queue[j]!;
            if (next[id] === "queued" || next[id] === "checking") {
              next[id] = "cancelled";
            }
          }
          return next;
        });
        break;
      }

      const sourceId = queue[i]!;
      setQueueIndex(i);
      try {
        const result = await checkOne(sourceId);
        lastCompletedId = sourceId;
        if (abortRef.current && result === "cancelled") {
          setRowStatus((prev) => {
            const next: Record<string, RowStatus> = {
              ...prev,
              [sourceId]: "cancelled",
            };
            for (let j = i + 1; j < queue.length; j += 1) {
              const id = queue[j]!;
              if (next[id] === "queued" || next[id] === "checking") {
                next[id] = "cancelled";
              }
            }
            return next;
          });
          break;
        }
        setRowStatus((prev) => ({ ...prev, [sourceId]: result }));
      } catch (err) {
        const message = err instanceof Error ? err.message : "Check failed";
        lastCompletedId = sourceId;
        if (abortRef.current || message === "Cancelled") {
          setRowStatus((prev) => {
            const next: Record<string, RowStatus> = {
              ...prev,
              [sourceId]: "cancelled",
            };
            for (let j = i + 1; j < queue.length; j += 1) {
              const id = queue[j]!;
              if (next[id] === "queued" || next[id] === "checking") {
                next[id] = "cancelled";
              }
            }
            return next;
          });
          break;
        }
        setRowStatus((prev) => ({ ...prev, [sourceId]: "error" }));
        setRowError((prev) => ({ ...prev, [sourceId]: message }));
      }
    }

    setRunning(false);
    setStopping(false);
    setCurrentSourceId(null);
    currentSourceIdRef.current = null;
    setFocusSourceId(lastCompletedId ?? queue[0] ?? null);
    void refreshSourcesList();
  }

  async function applyFocusedChanges() {
    if (!activeFocusId || panelActionBusy || running) return;
    setPanelActionBusy(true);
    setRunning(true);
    setRunningMode("refresh");
    setQueueTotal(1);
    setQueueIndex(0);
    setError(null);
    try {
      const result = await applyOne(activeFocusId);
      setRowStatus((prev) => ({ ...prev, [activeFocusId]: result }));
      void refreshSourcesList();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Apply failed";
      setRowStatus((prev) => ({ ...prev, [activeFocusId]: "error" }));
      setRowError((prev) => ({ ...prev, [activeFocusId]: message }));
    } finally {
      setRunning(false);
      setPanelActionBusy(false);
      setCurrentSourceId(null);
      currentSourceIdRef.current = null;
    }
  }

  async function dismissFocusedChanges() {
    if (!activeFocusId || panelActionBusy || running) return;
    setPanelActionBusy(true);
    try {
      await dismissSourceRefresh(activeFocusId);
      setRowStatus((prev) => ({ ...prev, [activeFocusId]: "idle" }));
      setChangelogs((prev) => {
        const next = { ...prev };
        delete next[activeFocusId];
        return next;
      });
      if (snapshot?.sourceId === activeFocusId) {
        setSnapshot(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to dismiss");
    } finally {
      setPanelActionBusy(false);
    }
  }

  async function updateOne(sourceId: string): Promise<RowStatus> {
    setCurrentSourceId(sourceId);
    currentSourceIdRef.current = sourceId;
    setFocusSourceId(sourceId);
    setSnapshot(null);
    setRowStatus((prev) => ({ ...prev, [sourceId]: "running" }));

    const { snapshot: started } = await startSourceRefreshCheck(
      sourceId,
      "discover",
    );
    setSnapshot(started);
    rememberChangelog(sourceId, started);

    const ready = await pollUntilSettled(
      sourceId,
      (snap) => snap.status === "ready" || snap.status === "done",
    );

    if (ready.status === "failed") {
      throw new Error(ready.error || "Refresh check failed");
    }
    if (ready.status === "cancelled") {
      return "cancelled";
    }

    if (ready.status === "done") {
      saveRunReport(sourceId, ready.changelog, "updated", "update");
      return "updated";
    }

    if (!refreshHasChanges(ready)) {
      rememberChangelog(sourceId, ready);
      saveRunReport(sourceId, ready.changelog, "up-to-date", "update");
      await dismissSourceRefresh(sourceId).catch(() => undefined);
      return "up-to-date";
    }

    const { snapshot: applying } = await applySourceRefresh(sourceId);
    setSnapshot(applying);
    rememberChangelog(sourceId, applying);
    const reportChangelog = applying.changelog;

    const finished = await pollUntilSettled(
      sourceId,
      (snap) => snap.status === "done",
    );
    if (finished.status === "failed") {
      throw new Error(finished.error || "Apply failed");
    }
    if (finished.status === "cancelled") {
      return "cancelled";
    }
    saveRunReport(sourceId, reportChangelog, "updated", "update");
    return "updated";
  }

  async function startQueue() {
    if (running || selected.size === 0 || !sources) return;
    const queue = sources
      .filter((source) => selected.has(source.id))
      .map((s) => s.id);
    if (queue.length === 0) return;

    abortRef.current = false;
    setRunning(true);
    setRunningMode("refresh");
    setStopping(false);
    setError(null);
    setQueueTotal(queue.length);
    setQueueIndex(0);
    setLastRunIds(queue);
    setFocusSourceId(queue[0] ?? null);
    setRowError({});
    setRowStatus((prev) => {
      const next = { ...prev };
      for (const id of queue) next[id] = "queued";
      return next;
    });

    syncDesktopApiBaseForScope(scope);

    let lastCompletedId: string | null = null;

    for (let i = 0; i < queue.length; i += 1) {
      if (abortRef.current) {
        setRowStatus((prev) => {
          const next = { ...prev };
          for (let j = i; j < queue.length; j += 1) {
            const id = queue[j]!;
            if (next[id] === "queued" || next[id] === "running") {
              next[id] = "cancelled";
            }
          }
          return next;
        });
        break;
      }

      const sourceId = queue[i]!;
      setQueueIndex(i);
      try {
        const result = await updateOne(sourceId);
        lastCompletedId = sourceId;
        if (abortRef.current && result === "cancelled") {
          setRowStatus((prev) => {
            const next: Record<string, RowStatus> = {
              ...prev,
              [sourceId]: "cancelled",
            };
            for (let j = i + 1; j < queue.length; j += 1) {
              const id = queue[j]!;
              if (next[id] === "queued" || next[id] === "running") {
                next[id] = "cancelled";
              }
            }
            return next;
          });
          break;
        }
        setRowStatus((prev) => ({ ...prev, [sourceId]: result }));
      } catch (err) {
        const message = err instanceof Error ? err.message : "Update failed";
        lastCompletedId = sourceId;
        if (abortRef.current || message === "Cancelled") {
          setRowStatus((prev) => {
            const next: Record<string, RowStatus> = {
              ...prev,
              [sourceId]: "cancelled",
            };
            for (let j = i + 1; j < queue.length; j += 1) {
              const id = queue[j]!;
              if (next[id] === "queued" || next[id] === "running") {
                next[id] = "cancelled";
              }
            }
            return next;
          });
          break;
        }
        // Keep going so later sets still run; overview shows what failed.
        setRowStatus((prev) => ({ ...prev, [sourceId]: "error" }));
        setRowError((prev) => ({ ...prev, [sourceId]: message }));
      }
    }

    setRunning(false);
    setStopping(false);
    setCurrentSourceId(null);
    currentSourceIdRef.current = null;
    setFocusSourceId(lastCompletedId ?? queue[0] ?? null);
    void refreshSourcesList();
    // Keep last snapshot/changelog + run overview visible.
  }

  async function stopQueue() {
    if (!running || stopping) return;
    abortRef.current = true;
    setStopping(true);
    const activeId = currentSourceIdRef.current;
    if (activeId) {
      try {
        if (runningMode === "catalog-crawl") {
          await cancelIngest(activeId);
        } else {
          await cancelSourceRefresh(activeId);
        }
      } catch {
        // ignore — local abort still stops the loop
      }
    }
    stopCatalogIngestPolling();
  }

  /**
   * Resume can hang after store already marked the run success (UI all-green).
   * Race the resume HTTP call against status polls + Stop so we always unblock.
   */
  async function awaitCatalogResume(
    sourceId: string,
    resumePromise: Promise<{ snapshot: IngestPipelineSnapshot }>,
  ): Promise<IngestPipelineSnapshot> {
    return await new Promise<IngestPipelineSnapshot>((resolve, reject) => {
      let settled = false;
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        window.clearInterval(interval);
        fn();
      };

      const interval = window.setInterval(() => {
        void (async () => {
          if (abortRef.current) {
            finish(() => reject(new Error("Cancelled")));
            return;
          }
          const runId = catalogIngestRunIdRef.current;
          if (!runId) return;
          try {
            const { snapshot } = await getIngestWorkflowStatus(sourceId, runId);
            if (!snapshot) return;
            setCatalogIngestSnapshot(snapshot);
            if (snapshot.status === "success") {
              finish(() => resolve(snapshot));
              return;
            }
            if (snapshot.status === "failed") {
              finish(() =>
                reject(new Error(snapshot.error || "Ingest failed")),
              );
            }
          } catch {
            // ignore transient status errors
          }
        })();
      }, 500);

      void resumePromise.then(
        ({ snapshot }) => {
          finish(() => resolve(snapshot));
        },
        (error) => {
          finish(() =>
            reject(error instanceof Error ? error : new Error(String(error))),
          );
        },
      );
    });
  }

  function resolveCatalogHosting(): SourceHosting {
    if (scope === "global" || !hostingCaps.localAvailable) return "cloud";
    return hostingCaps.default;
  }

  async function ensurePersonalProjectId(): Promise<string> {
    const existing = getDevProjectId();
    if (existing) return existing;
    const { project } = await createProject("My LedgeIndex project");
    setDevProjectId(project.id);
    return project.id;
  }

  async function ensureCatalogSource(input: {
    entry: TypescriptDocsCatalogEntry;
    crawlUrls: string[];
    hosting: SourceHosting;
    mode: CatalogCrawlMode;
  }): Promise<{ sourceId: string; ingestUrls: string[] }> {
    const { entry, crawlUrls, hosting, mode } = input;
    const name = catalogSourceName(entry);
    const sourceMetadata = catalogSourceMetadata(entry);
    const versionLabel = entry.selectedVersion || "latest";
    const identityUrl =
      effectiveCatalogDocsUrl(entry) || entry.docs || crawlUrls[0]!;

    syncApiBaseForHosting({ scope, hosting });

    const { duplicate } = await checkSourceDuplicates({
      url: identityUrl,
      scope,
      versionLabel,
    });

    if (mode === "paths-only" && !duplicate?.existing?.id) {
      throw new Error(
        "Paths-only update needs an existing source — run a full update first",
      );
    }

    if (duplicate?.existing?.id) {
      const sourceId = duplicate.existing.id;
      if (mode === "paths-only") {
        const { source } = await getSource(sourceId);
        const existingStarts = (source.config.startUrls ?? []).filter(Boolean);
        const persistedStarts = [
          ...new Set([...existingStarts, ...crawlUrls]),
        ];
        await updateSource(sourceId, {
          name,
          config: catalogCrawlConfig(persistedStarts, entry),
          sourceMetadata,
        });
        return { sourceId, ingestUrls: crawlUrls };
      }

      await updateSource(sourceId, {
        name,
        config: catalogCrawlConfig(crawlUrls, entry),
        sourceMetadata,
      });
      return { sourceId, ingestUrls: crawlUrls };
    }

    const createInput = {
      name,
      scope,
      hosting,
      config: catalogCrawlConfig(crawlUrls, entry),
      sourceMetadata,
      versionMode: "new" as const,
      versionLabel,
    };

    if (scope === "global") {
      const { source } = await createSource(createInput);
      return { sourceId: source.id, ingestUrls: crawlUrls };
    }

    let projectId = await ensurePersonalProjectId();
    try {
      const { source } = await createSource({ ...createInput, projectId });
      return { sourceId: source.id, ingestUrls: crawlUrls };
    } catch (error) {
      if (
        !(error instanceof KnowledgeIndexApiError) ||
        error.status !== 404 ||
        !projectId
      ) {
        throw error;
      }
      const { project } = await createProject("My LedgeIndex project");
      setDevProjectId(project.id);
      projectId = project.id;
      const { source } = await createSource({ ...createInput, projectId });
      return { sourceId: source.id, ingestUrls: crawlUrls };
    }
  }

  function stopCatalogIngestPolling() {
    catalogPollStopRef.current?.();
    catalogPollStopRef.current = null;
  }

  function startCatalogIngestPolling(sourceId: string) {
    stopCatalogIngestPolling();
    let cancelled = false;

    const tick = async () => {
      try {
        const progress = await getCrawlProgress(sourceId);
        if (!cancelled) {
          setCatalogCrawlPages(progress.pagesDiscovered);
        }
      } catch {
        // ignore transient crawl-progress errors
      }

      const runId = catalogIngestRunIdRef.current;
      if (!runId || cancelled) return;
      try {
        const { snapshot: live } = await getIngestWorkflowStatus(
          sourceId,
          runId,
        );
        if (!cancelled && live) {
          setCatalogIngestSnapshot(live);
        }
      } catch {
        // ignore transient status errors while start/resume is in flight
      }
    };

    void tick();
    const interval = window.setInterval(() => {
      void tick();
    }, 750);

    catalogPollStopRef.current = () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }

  async function runCatalogIngestToCompletion(
    sourceId: string,
    config: WebCrawlConfig,
  ): Promise<void> {
    catalogIngestRunIdRef.current = null;
    setCatalogCrawlPages(0);
    // Optimistic strip: crawl running before start returns.
    setCatalogIngestSnapshot({
      runId: "",
      status: "running",
      pipeline: pipelineFromCatalogIngest({
        snapshot: null,
        crawlPages: 0,
        maxPages: config.maxPages || 1000,
      }),
    });
    startCatalogIngestPolling(sourceId);

    try {
      const { snapshot: started } = await startIngestWorkflow(sourceId, {
        config,
      });
      let snap: IngestPipelineSnapshot = started;
      catalogIngestRunIdRef.current = snap.runId;
      setCatalogIngestSnapshot(snap);

      while (snap.status !== "success") {
        if (abortRef.current) {
          throw new Error("Cancelled");
        }
        if (snap.status === "failed") {
          throw new Error(snap.error || "Ingest failed");
        }

        if (snap.suspendedStep === "crawl-review-step") {
          const payload = snap.suspendPayload as {
            urls?: { url: string }[];
          };
          const urls = (payload.urls ?? []).map((row) => row.url).filter(Boolean);
          if (urls.length === 0) {
            throw new Error("No pages discovered for crawl");
          }
          const next = await awaitCatalogResume(
            sourceId,
            resumeIngestWorkflow(sourceId, snap.runId, {
              step: "crawl-review-step",
              resumeData: { selectedUrls: urls, enrichExamples: false },
            }),
          );
          snap = next;
          catalogIngestRunIdRef.current = snap.runId;
          setCatalogIngestSnapshot(snap);
          continue;
        }

        if (snap.suspendedStep === "parse-review-step") {
          const next = await awaitCatalogResume(
            sourceId,
            resumeIngestWorkflow(sourceId, snap.runId, {
              step: "parse-review-step",
              resumeData: { confirmed: true, enrichExamples: false },
            }),
          );
          snap = next;
          catalogIngestRunIdRef.current = snap.runId;
          setCatalogIngestSnapshot(snap);
          continue;
        }

        if (snap.suspendedStep === "enrich-step") {
          const next = await awaitCatalogResume(
            sourceId,
            resumeIngestWorkflow(sourceId, snap.runId, {
              step: "enrich-step",
              resumeData: { confirmed: true },
            }),
          );
          snap = next;
          catalogIngestRunIdRef.current = snap.runId;
          setCatalogIngestSnapshot(snap);
          continue;
        }

        // Running but not suspended yet (rare mid-poll) — wait for success/suspend.
        if (snap.status === "running") {
          await new Promise((r) => window.setTimeout(r, 400));
          if (abortRef.current) throw new Error("Cancelled");
          const runId = catalogIngestRunIdRef.current ?? snap.runId;
          const { snapshot: live } = await getIngestWorkflowStatus(
            sourceId,
            runId,
          );
          if (live) {
            snap = live;
            catalogIngestRunIdRef.current = snap.runId;
            setCatalogIngestSnapshot(snap);
            continue;
          }
        }

        throw new Error(
          snap.suspendedStep
            ? `Unexpected ingest pause: ${snap.suspendedStep}`
            : "Ingest did not complete",
        );
      }

      setCatalogIngestSnapshot(snap);
    } finally {
      stopCatalogIngestPolling();
    }
  }

  async function crawlOneCatalogPackage(
    packageName: string,
  ): Promise<RowStatus> {
    const entry =
      catalog?.entries.find((row) => row.package === packageName) ?? null;
    if (!entry) throw new Error("Package not in catalog");
    if (!isCatalogEntryCrawlReady(entry)) {
      throw new Error(
        `Docs not crawl-ready (${entry.docsStatus || "missing"})`,
      );
    }

    const crawlUrls = (
      selectedCatalogPaths[packageName] ??
      defaultCatalogPaths(entry, includeOptionalPathsAll)
    ).filter(Boolean);
    if (crawlUrls.length === 0) {
      throw new Error(
        catalogCrawlMode === "paths-only"
          ? "No paths selected for paths-only update"
          : "No start URLs selected",
      );
    }

    const hosting = resolveCatalogHosting();
    setCatalogCrawlPackage(packageName);
    setFocusCatalogPackage(packageName);
    setCatalogRowStatus((prev) => ({ ...prev, [packageName]: "running" }));

    const { sourceId, ingestUrls } = await ensureCatalogSource({
      entry,
      crawlUrls,
      hosting,
      mode: catalogCrawlMode,
    });
    setCurrentSourceId(sourceId);
    currentSourceIdRef.current = sourceId;

    if (abortRef.current) throw new Error("Cancelled");

    // Persist full selection on source for "full"; for paths-only, source already
    // has merged starts — ingest only the selected path URL(s).
    const ingestConfig = catalogCrawlConfig(ingestUrls, entry);
    await runCatalogIngestToCompletion(sourceId, ingestConfig);
    return "updated";
  }

  async function startCatalogCrawlQueue() {
    if (running || selectedCatalog.size === 0 || !catalog) return;
    const queue = [...selectedCatalog];
    if (queue.length === 0) return;

    abortRef.current = false;
    setRunning(true);
    setRunningMode("catalog-crawl");
    setStopping(false);
    setError(null);
    setSnapshot(null);
    setCatalogIngestSnapshot(null);
    setCatalogCrawlPages(null);
    catalogIngestRunIdRef.current = null;
    stopCatalogIngestPolling();
    setQueueTotal(queue.length);
    setQueueIndex(0);
    setCatalogCrawlPackage(queue[0] ?? null);
    setFocusCatalogPackage(queue[0] ?? null);
    setCatalogRowError({});
    setCatalogRowStatus((prev) => {
      const next = { ...prev };
      for (const pkg of queue) next[pkg] = "queued";
      return next;
    });

    const hosting = resolveCatalogHosting();
    syncApiBaseForHosting({ scope, hosting });

    for (let i = 0; i < queue.length; i += 1) {
      if (abortRef.current) {
        setCatalogRowStatus((prev) => {
          const next = { ...prev };
          for (let j = i; j < queue.length; j += 1) {
            const pkg = queue[j]!;
            if (next[pkg] === "queued" || next[pkg] === "running") {
              next[pkg] = "cancelled";
            }
          }
          return next;
        });
        break;
      }

      const packageName = queue[i]!;
      setQueueIndex(i);
      try {
        const result = await crawlOneCatalogPackage(packageName);
        if (abortRef.current && result === "cancelled") {
          setCatalogRowStatus((prev) => {
            const next: Record<string, RowStatus> = {
              ...prev,
              [packageName]: "cancelled",
            };
            for (let j = i + 1; j < queue.length; j += 1) {
              const pkg = queue[j]!;
              if (next[pkg] === "queued" || next[pkg] === "running") {
                next[pkg] = "cancelled";
              }
            }
            return next;
          });
          break;
        }
        setCatalogRowStatus((prev) => ({ ...prev, [packageName]: result }));
      } catch (err) {
        const message = err instanceof Error ? err.message : "Update failed";
        if (abortRef.current || message === "Cancelled") {
          setCatalogRowStatus((prev) => {
            const next: Record<string, RowStatus> = {
              ...prev,
              [packageName]: "cancelled",
            };
            for (let j = i + 1; j < queue.length; j += 1) {
              const pkg = queue[j]!;
              if (next[pkg] === "queued" || next[pkg] === "running") {
                next[pkg] = "cancelled";
              }
            }
            return next;
          });
          break;
        }
        setCatalogRowStatus((prev) => ({ ...prev, [packageName]: "error" }));
        setCatalogRowError((prev) => ({ ...prev, [packageName]: message }));
      }
    }

    setRunning(false);
    setStopping(false);
    setCurrentSourceId(null);
    currentSourceIdRef.current = null;
    setCatalogCrawlPackage(null);
    stopCatalogIngestPolling();
    catalogIngestRunIdRef.current = null;
    // Keep last ingest snapshot visible on the strip after the queue finishes.
    void load(scope);
  }

  if (!isAdmin) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
        <p className="text-sm text-muted">Admins only.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-6xl flex-1 flex-col overflow-hidden px-4 py-3 sm:px-6">
      <h1 className="shrink-0 text-xl font-semibold text-foreground">
        Source updater
      </h1>
      <div className="mt-2 flex shrink-0 flex-wrap items-center gap-1.5">
        <FilterBadge
          active={tab === "sources"}
          disabled={running && tab !== "sources"}
          onClick={() => setTab("sources")}
        >
          Existing sources
        </FilterBadge>
        <FilterBadge
          active={tab === "catalog"}
          disabled={running && tab !== "catalog"}
          onClick={() => setTab("catalog")}
        >
          Top {catalog ? catalogUsableEntries.length : "…"}
        </FilterBadge>

        {tab === "sources" ? (
          <>
            <span
              className="mx-0.5 hidden h-4 w-px bg-border sm:inline-block"
              aria-hidden
            />
            <FilterBadge
              active={scope === "personal"}
              disabled={running}
              onClick={() => handleScopeChange("personal")}
            >
              Just me
              <span className="opacity-60">
                ({scope === "personal" ? storageCounts.all : "—"})
              </span>
            </FilterBadge>
            <FilterBadge
              active={scope === "global"}
              disabled={running}
              onClick={() => handleScopeChange("global")}
              title="Public catalog — needs Postgres"
            >
              Public
            </FilterBadge>
            {scope === "personal" ? (
              <>
                <span
                  className="mx-0.5 hidden h-4 w-px bg-border sm:inline-block"
                  aria-hidden
                />
                <FilterBadge
                  active={storageFilter === "local"}
                  disabled={running}
                  onClick={() =>
                    setStorageFilter(
                      storageFilter === "local" ? "all" : "local",
                    )
                  }
                >
                  Local
                  <span className="opacity-60">({storageCounts.local})</span>
                </FilterBadge>
                <FilterBadge
                  active={storageFilter === "cloud"}
                  disabled={running}
                  onClick={() =>
                    setStorageFilter(
                      storageFilter === "cloud" ? "all" : "cloud",
                    )
                  }
                >
                  Cloud
                  <span className="opacity-60">({storageCounts.cloud})</span>
                </FilterBadge>
              </>
            ) : null}
            <span
              className="mx-0.5 hidden h-4 w-px bg-border sm:inline-block"
              aria-hidden
            />
            <FilterBadge
              active={false}
              disabled={running || !filteredSources?.length}
              onClick={toggleAll}
            >
              {filteredSources &&
              filteredSources.length > 0 &&
              filteredSources.every((source) => selected.has(source.id))
                ? "Clear all"
                : "Select all"}
            </FilterBadge>
            <FilterBadge
              active={selected.size > 0 && !running}
              disabled={running || selected.size === 0}
              onClick={() => void startCheckQueue()}
              title="Discover and compare pages — does not index until you apply"
            >
              <SearchCheck className="size-3" aria-hidden />
              Check {selected.size > 0 ? selected.size : ""} selected
            </FilterBadge>
            <FilterBadge
              active={selected.size > 0 && !running}
              disabled={running || selected.size === 0}
              onClick={() => void startQueue()}
              title="Check for changes, then apply automatically"
            >
              <RefreshCw className="size-3" aria-hidden />
              Update {selected.size > 0 ? selected.size : ""} selected
            </FilterBadge>
            {running ? (
              <FilterBadge
                active={false}
                disabled={stopping}
                onClick={() => void stopQueue()}
                className="border-red-500/40 text-red-700 hover:border-red-500/50 hover:text-red-700 dark:text-red-300"
              >
                <Square className="size-2.5 fill-current" aria-hidden />
                {stopping
                  ? "Stopping…"
                  : runningMode === "check"
                    ? "Stop check"
                    : "Stop sync"}
              </FilterBadge>
            ) : null}
          </>
        ) : (
          <>
            <span
              className="mx-0.5 hidden h-4 w-px bg-border sm:inline-block"
              aria-hidden
            />
            <FilterBadge
              active={scope === "personal"}
              disabled={running}
              onClick={() => handleScopeChange("personal")}
            >
              Just me
            </FilterBadge>
            <FilterBadge
              active={scope === "global"}
              disabled={running}
              onClick={() => handleScopeChange("global")}
              title="Public catalog — needs Postgres"
            >
              Public
            </FilterBadge>
            <span
              className="mx-0.5 hidden h-4 w-px bg-border sm:inline-block"
              aria-hidden
            />
            <FilterBadge
              active={catalogTop50Only}
              disabled={running}
              onClick={() => setCatalogTop50Only((prev) => !prev)}
              title="Hand-picked frameworks, runtimes, data, UI, and tooling"
            >
              Top {CURATED_TOP_DOCS_PACKAGES.length}
              <span className="opacity-60">
                ({catalogTop50PresentCount})
              </span>
            </FilterBadge>
            <FilterBadge
              active={false}
              disabled={running || catalogEntries.length === 0}
              onClick={toggleAllCatalog}
            >
              {catalogEntries.length > 0 &&
              catalogEntries.every((entry) =>
                selectedCatalog.has(entry.package),
              )
                ? "Clear all"
                : "Select all"}
            </FilterBadge>
            <FilterBadge
              active={includeOptionalPathsAll}
              disabled={
                running ||
                selectedCatalog.size === 0 ||
                catalogCrawlMode === "paths-only"
              }
              onClick={() => setIncludeOptionalPaths(!includeOptionalPathsAll)}
              title={
                catalogCrawlMode === "paths-only"
                  ? "In paths-only mode, pick paths per package instead"
                  : undefined
              }
            >
              {includeOptionalPathsAll
                ? "Optional: all"
                : "Optional: main"}
            </FilterBadge>
            <FilterBadge
              active={catalogCrawlMode === "paths-only"}
              disabled={running}
              onClick={() => {
                setCatalogCrawlMode((prev) => {
                  const next =
                    prev === "full" ? "paths-only" : "full";
                  if (next === "paths-only") {
                    // Clear ticks — pick exactly which path(s) to update (main not forced).
                    setSelectedCatalogPaths((pathsPrev) => {
                      const updated = { ...pathsPrev };
                      for (const pkg of selectedCatalog) {
                        updated[pkg] = [];
                      }
                      return updated;
                    });
                  } else {
                    // Re-lock main docs into every selected package.
                    setSelectedCatalogPaths((pathsPrev) => {
                      const updated = { ...pathsPrev };
                      for (const pkg of selectedCatalog) {
                        const entry = catalog?.entries.find(
                          (row) => row.package === pkg,
                        );
                        if (!entry?.docs) continue;
                        const current = new Set(
                          updated[pkg] ??
                            defaultCatalogPaths(entry, includeOptionalPathsAll),
                        );
                        current.add(entry.docs);
                        updated[pkg] = [...current];
                      }
                      return updated;
                    });
                  }
                  return next;
                });
              }}
              title="Paths only: tick the path(s) to update (main can stay off). Needs an existing source from a prior full update."
            >
              {catalogCrawlMode === "paths-only"
                ? "Scope: paths only"
                : "Scope: full"}
            </FilterBadge>
            <FilterBadge
              active={selectedCatalog.size > 0 && !running}
              disabled={
                running ||
                selectedCatalog.size === 0 ||
                (catalogCrawlMode === "paths-only" &&
                  catalogSelectedPathCount === 0)
              }
              onClick={() => void startCatalogCrawlQueue()}
              title={
                catalogCrawlMode === "paths-only"
                  ? catalogSelectedPathCount === 0
                    ? "Tick at least one path badge on a selected package"
                    : `Paths-only: merge selected paths into existing ${scope === "global" ? "public" : "personal"} sources and index those URLs`
                  : `Create or update ${scope === "global" ? "public" : "personal"} sources for selected packages`
              }
            >
              <RefreshCw className="size-3" aria-hidden />
              Update {selectedCatalog.size > 0 ? selectedCatalog.size : ""}{" "}
              selected
            </FilterBadge>
            {running && runningMode === "catalog-crawl" ? (
              <FilterBadge
                active={false}
                disabled={stopping}
                onClick={() => void stopQueue()}
                className="border-red-500/40 text-red-700 hover:border-red-500/50 hover:text-red-700 dark:text-red-300"
              >
                <Square className="size-2.5 fill-current" aria-hidden />
                {stopping ? "Stopping…" : "Stop sync"}
              </FilterBadge>
            ) : null}
            <FilterBadge
              active={showFailedMissingDocs}
              disabled={running}
              onClick={() => setShowFailedMissingDocs((prev) => !prev)}
              title="Include docs that failed verification or are still uncertain/missing"
            >
              {showFailedMissingDocs ? "Failed/missing: on" : "Failed/missing"}
            </FilterBadge>
            {CATALOG_RANK_OPTIONS.map((option) => {
              const active = catalogRankMode === option.value;
              return (
                <FilterBadge
                  key={option.value}
                  active={active}
                  disabled={running || catalogTop50Only}
                  onClick={() => setCatalogRankMode(option.value)}
                >
                  {option.label}
                </FilterBadge>
              );
            })}
            <CatalogManualPackageForm
              canPersist={canPersistCatalogPaths}
              onSaved={applySavedCatalogEntry}
            />
            <input
              type="search"
              value={catalogQuery}
              onChange={(event) => setCatalogQuery(event.target.value)}
              placeholder="Search packages…"
              disabled={running}
              className="h-7 min-w-[10rem] flex-1 rounded-md border border-border bg-card-solid px-2.5 text-xs text-foreground placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/20 sm:max-w-[14rem]"
            />
          </>
        )}
      </div>

      {tab === "sources" ? (
        <div className="mt-3 flex min-h-0 flex-1 flex-col overflow-hidden">
          {error ? (
            <p className="mb-2 shrink-0 text-sm text-red-600 dark:text-red-300">
              {error}
            </p>
          ) : null}

          {filteredSources && lastRunIds.length > 0 ? (
            <div className="mb-3 shrink-0">
              <RunOverview
                runIds={lastRunIds}
                sources={sources ?? []}
                rowStatus={rowStatus}
                rowError={rowError}
                changelogs={changelogs}
                runReports={runReports}
                running={running}
                stopping={stopping}
                onFocus={setFocusSourceId}
              />
            </div>
          ) : null}

          <div className="grid min-h-0 flex-1 gap-4 overflow-hidden lg:grid-cols-[minmax(0,1.1fr)_minmax(18rem,0.9fr)]">
            <div className="min-h-0 overflow-y-auto overscroll-contain rounded-xl border border-border bg-card-solid">
              {filteredSources === null ? (
                <p className="px-4 py-6 text-sm text-muted">Loading sets…</p>
              ) : filteredSources.length === 0 ? (
                <p className="px-4 py-6 text-sm text-muted">
                  {sources && sources.length > 0
                    ? "No sets match this storage filter."
                    : "No sets in this scope."}
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {filteredSources.map((source) => {
                    const checked = selected.has(source.id);
                    const status = rowStatus[source.id] ?? "idle";
                    const isCurrent = currentSourceId === source.id;
                    const isFocused = activeFocusId === source.id;
                    const startUrls = resolveStartUrls(source);
                    const rowChangelog =
                      changelogs[source.id] ?? runReports[source.id]?.changelog;
                    const pathBuckets = changelogPathBuckets(
                      rowChangelog,
                      startUrls,
                    );
                    const hasReport = Boolean(runReports[source.id]);
                    return (
                      <li key={source.id}>
                        <div
                          className={cn(
                            "flex items-center gap-3 px-3 py-2 transition-colors",
                            (isCurrent || isFocused) && "bg-accent/8",
                          )}
                        >
                          <input
                            type="checkbox"
                            className="size-3.5 shrink-0"
                            checked={checked}
                            disabled={running}
                            onChange={() => toggle(source.id)}
                            aria-label={`Select ${source.name}`}
                          />
                          <button
                            type="button"
                            className="flex min-w-0 flex-1 items-center gap-3 text-left"
                            onClick={() => setFocusSourceId(source.id)}
                          >
                            <SourceFavicon source={source} />
                            <div className="min-w-0 flex-1">
                              <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                                <p className="truncate text-sm font-medium text-foreground">
                                  {source.name}
                                </p>
                                <CrawlFiltersBadge source={source} />
                              </div>
                              <p className="truncate font-mono text-[0.625rem] text-muted">
                                {formatUrlLabel(source.startUrl || source.name)}{" "}
                                · {source.pageCount} pages
                              </p>
                              <StartUrlChips urls={startUrls} />
                              {pathBuckets.length > 0 ? (
                                <div className="mt-1 flex flex-wrap gap-1">
                                  {pathBuckets.map((bucket) => {
                                    const total =
                                      bucket.added +
                                      bucket.updated +
                                      bucket.removed;
                                    return (
                                      <span
                                        key={bucket.label}
                                        title={[
                                          bucket.added
                                            ? `${bucket.added} added`
                                            : null,
                                          bucket.updated
                                            ? `${bucket.updated} updated`
                                            : null,
                                          bucket.removed
                                            ? `${bucket.removed} removed`
                                            : null,
                                        ]
                                          .filter(Boolean)
                                          .join(" · ")}
                                        className="inline-flex max-w-[10rem] items-center gap-1 truncate rounded border border-amber-500/35 bg-amber-500/10 px-1.5 py-0.5 font-mono text-[0.5rem] font-semibold text-amber-800 dark:text-amber-300"
                                      >
                                        <span className="truncate">
                                          {bucket.label}
                                        </span>
                                        <span className="opacity-80">
                                          {total}
                                        </span>
                                      </span>
                                    );
                                  })}
                                </div>
                              ) : null}
                              {rowError[source.id] ? (
                                <p className="mt-0.5 truncate text-[0.625rem] text-red-600 dark:text-red-300">
                                  {rowError[source.id]}
                                </p>
                              ) : null}
                            </div>
                          </button>
                          <div className="flex shrink-0 items-center gap-1.5">
                            {hasReport ? (
                              <button
                                type="button"
                                onClick={() => setFocusSourceId(source.id)}
                                title="View run report"
                                className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-card-solid px-2 font-mono text-[0.5rem] font-semibold tracking-[0.06em] text-muted uppercase hover:border-accent/40 hover:text-foreground"
                              >
                                <ClipboardList
                                  className="size-3 shrink-0"
                                  aria-hidden
                                />
                                Report
                              </button>
                            ) : null}
                            {status !== "idle" ? (
                              <span
                                className={cn(
                                  "rounded-md border px-2 py-0.5 font-mono text-[0.5rem] font-semibold tracking-[0.08em] uppercase",
                                  status === "running" &&
                                    "border-accent/40 bg-accent/10 text-accent",
                                  status === "checking" &&
                                    "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300",
                                  status === "queued" &&
                                    "border-border bg-surface-alt text-muted",
                                  (status === "updated" ||
                                    status === "up-to-date") &&
                                    "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
                                  status === "changes-found" &&
                                    "border-amber-500/35 bg-amber-500/10 text-amber-800 dark:text-amber-300",
                                  status === "error" &&
                                    "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300",
                                  status === "cancelled" &&
                                    "border-border bg-surface-alt text-muted",
                                )}
                              >
                                {statusLabel(status)}
                              </span>
                            ) : null}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className="min-h-0 overflow-hidden">
              <ChangesSidePanel
                source={focusSource}
                changelog={focusChangelog}
                status={
                  activeFocusId ? (rowStatus[activeFocusId] ?? "idle") : "idle"
                }
                running={running || panelActionBusy}
                errorMessage={
                  activeFocusId ? rowError[activeFocusId] : undefined
                }
                hasLastRun={lastRunIds.length > 0}
                reportMeta={focusReportMeta}
                onApply={
                  activeFocusId &&
                  rowStatus[activeFocusId] === "changes-found"
                    ? () => void applyFocusedChanges()
                    : undefined
                }
                onDismiss={
                  activeFocusId &&
                  rowStatus[activeFocusId] === "changes-found"
                    ? () => void dismissFocusedChanges()
                    : undefined
                }
                actionBusy={panelActionBusy}
              />
            </div>
          </div>

          <div className="shrink-0 border-t border-border bg-surface-alt/95 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-sm">
            <IngestPipelineFlow
              pipeline={pipeline}
              headline={headline}
              variant="banner"
              bannerSize="strip"
              animate={
                (running && runningMode !== "catalog-crawl") || panelActionBusy
              }
              className="w-full"
            />
          </div>
        </div>
      ) : (
        <div className="mt-3 flex min-h-0 flex-1 flex-col overflow-hidden">
          {catalogError ? (
            <p className="mb-2 shrink-0 text-sm text-red-600 dark:text-red-300">
              {catalogError}
            </p>
          ) : null}

          <div className="flex shrink-0 flex-wrap items-center gap-1.5">
            {CATALOG_PATHS_FILTER_OPTIONS.map((option) => {
              const active = catalogPathsFilter === option.value;
              const count = catalogPathsFilterCounts[option.value];
              return (
                <FilterBadge
                  key={option.value}
                  active={active}
                  onClick={() => setCatalogPathsFilter(option.value)}
                >
                  {option.label}
                  <span className="opacity-60">({count})</span>
                </FilterBadge>
              );
            })}
            <span
              className="mx-0.5 hidden h-4 w-px bg-border sm:inline-block"
              aria-hidden
            />
            {CATALOG_CATEGORY_OPTIONS.map((option) => {
              const active = catalogCategory === option.value;
              const count = catalogCategoryCounts[option.value];
              return (
                <FilterBadge
                  key={option.value}
                  active={active}
                  onClick={() => setCatalogCategory(option.value)}
                >
                  {option.label}
                  <span className="opacity-60">({count})</span>
                </FilterBadge>
              );
            })}
            {catalog ? (
              <p className="ml-auto font-mono text-[0.625rem] text-muted">
                {selectedCatalog.size > 0
                  ? `${selectedCatalog.size} selected · `
                  : ""}
                {catalogEntries.length} shown · {catalogReadyCount} usable
              </p>
            ) : null}
          </div>

          <div className="mt-3 grid min-h-0 flex-1 gap-4 overflow-hidden lg:grid-cols-[minmax(0,1.1fr)_minmax(18rem,0.9fr)]">
            <div className="min-h-0 overflow-y-auto overscroll-contain rounded-xl border border-border bg-card-solid">
              {catalogLoading && !catalog ? (
                <p className="px-4 py-6 text-sm text-muted">
                  Loading catalog…
                </p>
              ) : !catalog ? (
                <p className="px-4 py-6 text-sm text-muted">
                  Catalog not loaded.
                </p>
              ) : catalogEntries.length === 0 ? (
                <p className="px-4 py-6 text-sm text-muted">
                  No packages match this filter.
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {catalogEntries.map((entry) => {
                    const checked = selectedCatalog.has(entry.package);
                    const focused = focusCatalogPackage === entry.package;
                    const crawlStatus = catalogRowStatus[entry.package] ?? "idle";
                    const crawlError = catalogRowError[entry.package];
                    const statusLabel = catalogRowStatusLabel(crawlStatus);
                    const indexState = catalogIndexByPackage.get(entry.package);
                    const isActivelyUpdating =
                      running &&
                      runningMode === "catalog-crawl" &&
                      catalogCrawlPackage === entry.package;
                    const configureHref = catalogWebCrawlHref(entry, scope);
                    const curatedRank = curatedTopDocsRank(entry.package);
                    const rankLabel = String(
                      catalogTop50Only && curatedRank != null
                        ? curatedRank
                        : (catalogDisplayRankByPackage.get(entry.package) ??
                            "—"),
                    );
                    const rankTitle = catalogTop50Only
                      ? `Curated Top ${CURATED_TOP_DOCS_PACKAGES.length} #${rankLabel}`
                      : `Rank #${rankLabel} (${catalogRankMode})`;
                    return (
                      <li key={entry.package}>
                        <div
                          className={cn(
                            "flex items-center gap-3 px-3 py-2.5 transition-colors",
                            isActivelyUpdating
                              ? "bg-accent/12 ring-1 ring-inset ring-accent/30"
                              : focused && "bg-accent/8",
                          )}
                        >
                          <input
                            type="checkbox"
                            className="size-3.5 shrink-0"
                            checked={checked}
                            disabled={running}
                            onChange={() => toggleCatalog(entry.package)}
                            aria-label={`Select ${entry.package}`}
                          />
                          <span
                            className="w-8 shrink-0 text-right font-mono text-[0.6875rem] font-semibold tabular-nums text-muted"
                            title={rankTitle}
                          >
                            {rankLabel}
                          </span>
                          <div className="flex min-w-0 flex-1 flex-col gap-0">
                            <div
                              role="button"
                              tabIndex={0}
                              className="flex min-w-0 cursor-pointer items-start gap-3 text-left"
                              onClick={() =>
                                setFocusCatalogPackage(entry.package)
                              }
                              onKeyDown={(event) => {
                                if (event.key === "Enter" || event.key === " ") {
                                  event.preventDefault();
                                  setFocusCatalogPackage(entry.package);
                                }
                              }}
                            >
                              <div className="min-w-0 flex-1">
                                <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                                  <CatalogPackageName
                                    name={entry.package}
                                    href={configureHref}
                                    className="truncate text-sm font-medium text-foreground"
                                  />
                                  {statusLabel ? (
                                    <span
                                      className={cn(
                                        "rounded-md border px-1.5 py-0.5 font-mono text-[0.5rem] font-semibold tracking-[0.08em] uppercase",
                                        crawlStatus === "updated"
                                          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                                          : crawlStatus === "error"
                                            ? "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300"
                                            : crawlStatus === "running"
                                              ? "border-accent/35 bg-accent/10 text-accent"
                                              : "border-border bg-surface-alt text-muted",
                                      )}
                                      title={crawlError || undefined}
                                    >
                                      {statusLabel}
                                    </span>
                                  ) : null}
                                  <span className="rounded-md border border-border bg-surface-alt px-1.5 py-0.5 font-mono text-[0.5rem] font-semibold tracking-[0.08em] text-muted uppercase">
                                    {categoryLabel(entry.category)}
                                  </span>
                                  {(() => {
                                    // Path pills already show discovery success — only badge problems.
                                    const bucket = catalogPathsBucket(entry);
                                    if (bucket === "discovered") return null;
                                    return (
                                      <span
                                        className={cn(
                                          "rounded-md border px-1.5 py-0.5 font-mono text-[0.5rem] font-semibold tracking-[0.08em] uppercase",
                                          bucket === "uncertain"
                                            ? "border-amber-500/35 bg-amber-500/10 text-amber-800 dark:text-amber-300"
                                            : bucket === "failed"
                                              ? "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300"
                                              : "border-border bg-surface-alt text-muted",
                                        )}
                                        title={entry.pathsReason || undefined}
                                      >
                                        paths:{bucket}
                                      </span>
                                    );
                                  })()}
                                  {!isCatalogEntryCrawlReady(entry) ? (
                                    <span className="rounded-md border border-amber-500/35 bg-amber-500/10 px-1.5 py-0.5 font-mono text-[0.5rem] font-semibold tracking-[0.08em] text-amber-800 uppercase dark:text-amber-300">
                                      docs:{entry.docsStatus || "missing"}
                                    </span>
                                  ) : null}
                                  <CatalogExcludeBadge entry={entry} />
                                  <CatalogVersionsBadge entry={entry} />
                                </div>
                                <p className="mt-0.5 truncate font-mono text-[0.625rem] text-muted">
                                  {entry.docs
                                    ? formatUrlLabel(entry.docs)
                                    : "docs pending"}
                                </p>
                                {crawlError ? (
                                  <p className="mt-0.5 truncate text-[0.625rem] text-red-600 dark:text-red-300">
                                    {crawlError}
                                  </p>
                                ) : null}
                              </div>
                              <CatalogMetricChips
                                entry={entry}
                                rankMode={catalogRankMode}
                                layout="stack"
                              />
                            </div>
                            <div
                              className="min-w-0"
                              onClick={(event) => event.stopPropagation()}
                            >
                              <CatalogPathBadges
                                entry={entry}
                                compact
                                allowDeselectMain={
                                  catalogCrawlMode === "paths-only"
                                }
                                indexedUrls={
                                  indexState?.indexedPathKeys ?? null
                                }
                                selectedUrls={
                                  selectedCatalog.has(entry.package)
                                    ? pathsSetForPackage(entry.package)
                                    : null
                                }
                                onToggleUrl={
                                  selectedCatalog.has(entry.package)
                                    ? (url, next) =>
                                        toggleCatalogPath(
                                          entry.package,
                                          url,
                                          next,
                                        )
                                    : undefined
                                }
                              />
                              {entry.versions.length > 1 ? (
                                <div className="mt-1 flex flex-wrap gap-1">
                                  {entry.versions.map((version) => (
                                    <span
                                      key={version}
                                      className={cn(
                                        "rounded border px-1.5 py-0.5 font-mono text-[0.5rem] font-semibold",
                                        version === entry.selectedVersion
                                          ? "border-accent/35 bg-accent/10 text-accent"
                                          : "border-border bg-surface-alt text-muted",
                                      )}
                                    >
                                      {version}
                                    </span>
                                  ))}
                                </div>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className="min-h-0 overflow-hidden">
              <CatalogDetailPanel
                entry={focusCatalogEntry}
                rankMode={catalogRankMode}
                scope={scope}
                displayRank={
                  focusCatalogEntry
                    ? (catalogDisplayRankByPackage.get(
                        focusCatalogEntry.package,
                      ) ?? null)
                    : null
                }
                indexState={
                  focusCatalogEntry
                    ? catalogIndexByPackage.get(focusCatalogEntry.package)
                    : undefined
                }
                selectedUrls={
                  focusCatalogEntry
                    ? pathsSetForPackage(focusCatalogEntry.package)
                    : null
                }
                onToggleUrl={(url, next) => {
                  if (!focusCatalogEntry) return;
                  toggleCatalogPath(focusCatalogEntry.package, url, next);
                }}
                allowDeselectMain={catalogCrawlMode === "paths-only"}
                canPersistPaths={canPersistCatalogPaths}
                onPathsSaved={applySavedCatalogEntry}
              />
            </div>
          </div>

          <div className="shrink-0 border-t border-border bg-surface-alt/95 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-sm">
            <IngestPipelineFlow
              pipeline={pipeline}
              headline={headline}
              variant="banner"
              bannerSize="strip"
              animate={running && runningMode === "catalog-crawl"}
              className="w-full"
            />
          </div>
        </div>
      )}
    </div>
  );
}
