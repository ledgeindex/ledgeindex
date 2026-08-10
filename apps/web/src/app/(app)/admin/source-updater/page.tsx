"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw, Square } from "lucide-react";
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
  pipelineFromRefreshSnapshot,
  refreshHasChanges,
} from "@/lib/admin-source-updater";
import { syncDesktopApiBaseForScope } from "@/lib/desktop-api-routing";
import { publicAssetUrl } from "@/lib/public-asset-url";
import { cn } from "@/lib/utils";
import {
  applySourceRefresh,
  cancelSourceRefresh,
  dismissSourceRefresh,
  getSourceRefreshStatus,
  listSources,
  startSourceRefreshCheck,
  type RefreshChangelog,
  type RefreshPageRef,
  type RefreshRunSnapshot,
  type SourceSummary,
} from "@/lib/ledgeindex-api";
import {
  isCatalogEntryCrawlReady,
  normalizeCatalogEntry,
  type TypescriptDocsCatalog,
  type TypescriptDocsCatalogEntry,
} from "@/lib/typescript-docs-catalog";
import { CatalogPathsMaintainPanel } from "@/components/admin/catalog-paths-maintain-panel";
import { CatalogManualPackageForm } from "@/components/admin/catalog-manual-package-form";

type UpdaterTab = "sources" | "catalog";
type StorageFilter = "all" | "local" | "cloud";
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
  | "up-to-date"
  | "updated"
  | "error"
  | "cancelled";

const POLL_MS = 1500;

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
    case "up-to-date":
      return "Up to date";
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
  if (!changelog || changelog.baselineCaptured) return [];

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
    else if (status === "error") counts.error += 1;
    else if (status === "cancelled") counts.cancelled += 1;
    else if (status === "queued") counts.queued += 1;
    else if (status === "running") counts.running += 1;
  }
  counts.done =
    counts.updated + counts.upToDate + counts.error + counts.cancelled;
  return counts;
}

function RunOverview({
  runIds,
  sources,
  rowStatus,
  rowError,
  changelogs,
  running,
  stopping,
  onFocus,
}: {
  runIds: string[];
  sources: SourceSummary[];
  rowStatus: Record<string, RowStatus>;
  rowError: Record<string, string>;
  changelogs: Record<string, RefreshChangelog>;
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
          status === "running"
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
            const status = rowStatus[id] ?? "idle";
            const changelog = changelogs[id];
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
}: {
  source: SourceSummary | null;
  changelog: RefreshChangelog | null;
  status: RowStatus;
  running: boolean;
  errorMessage?: string;
  hasLastRun: boolean;
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
            : "Select a set on the left. While it updates, added / updated / removed pages show up here."}
        </p>
      </div>
    );
  }

  const hasDiff =
    changelog &&
    !changelog.baselineCaptured &&
    (changelog.added.length > 0 ||
      changelog.updated.length > 0 ||
      changelog.removed.length > 0);

  const excludes = sourceExcludePatterns(source);
  const includes = sourceIncludePatterns(source);
  const startUrls = resolveStartUrls(source);
  const pathBuckets = changelogPathBuckets(changelog, startUrls);
  const finished =
    !running &&
    (status === "updated" ||
      status === "up-to-date" ||
      status === "error" ||
      status === "cancelled");

  return (
    <div className="flex h-full min-h-0 flex-col rounded-xl border border-border bg-card-solid">
      <div className="shrink-0 border-b border-border px-3 py-2.5">
        <div className="flex items-start justify-between gap-2">
          <p className="min-w-0 truncate text-sm font-medium text-foreground">
            {source.name}
          </p>
          <CrawlFiltersBadge source={source} />
        </div>
        <p className="truncate font-mono text-[0.625rem] text-muted">
          {formatUrlLabel(source.startUrl || source.name)}
          {status !== "idle" ? ` · ${statusLabel(status)}` : null}
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
                : status === "updated"
                  ? "Update finished"
                  : status === "error"
                    ? "Update failed"
                    : "Update cancelled"}
            </p>
            <p className="mt-0.5 text-[0.6875rem] leading-5 text-muted">
              {status === "up-to-date"
                ? "Refresh found no page changes to apply."
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

        {running && status === "running" && !changelog ? (
          <p className="text-xs text-muted">Checking for page changes…</p>
        ) : null}

        {changelog?.baselineCaptured ? (
          <p className="text-xs leading-5 text-muted">
            Baseline snapshot captured — no diff yet for this set.
          </p>
        ) : null}

        {changelog && !changelog.baselineCaptured && !hasDiff ? (
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
            Run an update to see the page diff for this set.
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
}: {
  entry: TypescriptDocsCatalogEntry;
  compact?: boolean;
  /** When set, badges become selectable (main is always on). */
  selectedUrls?: Set<string> | null;
  onToggleUrl?: (url: string, next: boolean) => void;
}) {
  const badges = catalogPathBadges(entry);
  if (badges.length === 0) return null;
  const selectable = Boolean(selectedUrls && onToggleUrl);

  return (
    <div className={cn("flex flex-wrap gap-1", compact ? "mt-1" : "mt-0.5")}>
      {badges.map((badge) => {
        const key = normalizePathKey(badge.url);
        const checked = badge.primary
          ? true
          : selectedUrls
            ? [...selectedUrls].some((url) => normalizePathKey(url) === key)
            : false;
        const optionalOff = selectable && !badge.primary && !checked;

        if (selectable && !compact) {
          return (
            <div
              key={`${badge.kind}:${badge.url}`}
              className={cn(
                "inline-flex max-w-full items-center gap-1.5 truncate rounded-md border px-1.5 py-0.5 font-mono text-[0.5rem] font-semibold transition-colors",
                badge.primary || checked
                  ? "border-accent/40 bg-accent/10 text-accent"
                  : "border-border bg-surface-alt text-muted hover:border-border/80 hover:text-foreground",
              )}
            >
              <input
                type="checkbox"
                className="size-3 shrink-0 cursor-pointer"
                checked={checked}
                disabled={badge.primary}
                onChange={(event) => {
                  if (badge.primary) return;
                  onToggleUrl?.(badge.url, event.target.checked);
                }}
                aria-label={`Include ${badge.kind} path ${badge.label || badge.url}`}
                title={
                  badge.primary
                    ? "Main docs path is always included"
                    : "Include this path in the crawl"
                }
              />
              <a
                href={badge.url}
                target="_blank"
                rel="noreferrer"
                title={`Open ${badge.url}`}
                className="inline-flex min-w-0 items-center gap-1 truncate hover:underline"
              >
                <span className="shrink-0 tracking-[0.06em] uppercase">
                  {badge.kind}
                  {badge.primary ? " · main" : ""}
                </span>
                <span className="min-w-0 truncate normal-case tracking-normal opacity-80">
                  {badge.label || formatStartPathLabel(badge.url)}
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
            title={badge.url}
            className={cn(
              "inline-flex max-w-full items-center gap-1 truncate rounded-md border px-1.5 py-0.5 font-mono text-[0.5rem] font-semibold transition-colors hover:border-accent/50",
              badge.primary
                ? "border-accent/40 bg-accent/10 text-accent"
                : optionalOff
                  ? "border-border/60 bg-surface-alt/60 text-muted opacity-50"
                  : checked && selectedUrls
                    ? "border-accent/35 bg-accent/8 text-accent"
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
  canPersistPaths,
  onPathsSaved,
}: {
  entry: TypescriptDocsCatalogEntry | null;
  rankMode: CatalogRankMode;
  displayRank: number | null;
  selectedUrls?: Set<string> | null;
  onToggleUrl?: (url: string, next: boolean) => void;
  canPersistPaths: boolean;
  onPathsSaved: (next: TypescriptDocsCatalogEntry) => void;
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

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto overscroll-contain rounded-xl border border-border bg-card-solid p-4">
      <div className="shrink-0">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">
              {entry.package}
            </p>
            <p className="mt-0.5 text-xs text-muted">
              {categoryLabel(entry.category)}
              {displayRank != null ? ` · #${displayRank}` : ""}
            </p>
          </div>
          <CatalogMetricChips entry={entry} rankMode={rankMode} layout="stack" />
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
          Crawl selection
        </p>
        <p className="text-[0.625rem] leading-4 text-muted">
          When adding sets from Top N, main docs is always included. Tick
          optional paths to crawl them too
          {optionalCount > 0 ? ` · ${optionalCount} optional` : ""}.
        </p>
        {pathBadges.length > 0 ? (
          <CatalogPathBadges
            entry={entry}
            selectedUrls={selectedUrls ?? null}
            onToggleUrl={onToggleUrl}
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
          Default crawl target: {entry.selectedVersion}
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
            None yet — fill via exclude-pattern script, then crawls skip
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
  const [focusSourceId, setFocusSourceId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [currentSourceId, setCurrentSourceId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<RefreshRunSnapshot | null>(null);
  const [queueIndex, setQueueIndex] = useState(0);
  const [queueTotal, setQueueTotal] = useState(0);
  const [lastRunIds, setLastRunIds] = useState<string[]>([]);
  const abortRef = useRef(false);
  const currentSourceIdRef = useRef<string | null>(null);

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
      .sort((a, b) => compareCatalogEntries(a, b, catalogRankMode));
  }, [
    catalogReviewEntries,
    catalogCategory,
    catalogPathsFilter,
    catalogQuery,
    catalogRankMode,
  ]);

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
    if (snapshot?.sourceId === activeFocusId && snapshot.changelog) {
      return snapshot.changelog;
    }
    if (!activeFocusId) return null;
    return changelogs[activeFocusId] ?? null;
  }, [activeFocusId, changelogs, snapshot]);

  const pipeline = useMemo(
    () =>
      running
        ? pipelineFromRefreshSnapshot(snapshot)
        : IDLE_INGEST_PIPELINE.map((node) => ({ ...node })),
    [running, snapshot],
  );

  const headline = useMemo(() => {
    if (tab === "catalog") {
      if (selectedCatalog.size === 0) return "Select packages to add";
      const pathCount = [...selectedCatalog].reduce((sum, pkg) => {
        return sum + (selectedCatalogPaths[pkg]?.length ?? 1);
      }, 0);
      return includeOptionalPathsAll
        ? `${selectedCatalog.size} selected · ${pathCount} paths (optional on)`
        : `${selectedCatalog.size} selected · main path only (${pathCount})`;
    }
    if (!running) {
      return selected.size > 0
        ? `${selected.size} selected — ready to update`
        : "Select sources to update";
    }
    const pathBit =
      snapshot?.activePath &&
      snapshot.pathTotal &&
      snapshot.pathTotal > 1
        ? ` · ${snapshot.activePath} (${snapshot.pathIndex}/${snapshot.pathTotal})`
        : "";
    if (!focusSource) {
      return `Updating ${queueIndex + 1} / ${queueTotal}${pathBit}`;
    }
    return `${focusSource.name} · ${queueIndex + 1} / ${queueTotal}${pathBit}`;
  }, [
    focusSource,
    queueIndex,
    queueTotal,
    running,
    selected.size,
    selectedCatalog.size,
    selectedCatalogPaths,
    includeOptionalPathsAll,
    snapshot?.activePath,
    snapshot?.pathIndex,
    snapshot?.pathTotal,
    tab,
  ]);

  function rememberChangelog(
    sourceId: string,
    next: RefreshRunSnapshot | null | undefined,
  ) {
    if (!next?.changelog) return;
    setChangelogs((prev) => ({ ...prev, [sourceId]: next.changelog! }));
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
            [packageName]: defaultCatalogPaths(entry, includeOptionalPathsAll),
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
        next[entry.package] = defaultCatalogPaths(
          entry,
          includeOptionalPathsAll,
        );
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
    if (normalizePathKey(url) === mainKey) return;

    setSelectedCatalog((prev) => {
      if (prev.has(packageName)) return prev;
      const next = new Set(prev);
      next.add(packageName);
      return next;
    });

    setSelectedCatalogPaths((prev) => {
      const current = new Set(
        prev[packageName] ?? defaultCatalogPaths(entry, false),
      );
      if (enabled) current.add(url);
      else current.delete(url);
      // Always keep main.
      current.add(entry.docs!);
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
      return "updated";
    }

    if (!refreshHasChanges(ready)) {
      rememberChangelog(sourceId, ready);
      await dismissSourceRefresh(sourceId).catch(() => undefined);
      return "up-to-date";
    }

    const { snapshot: applying } = await applySourceRefresh(sourceId);
    setSnapshot(applying);
    rememberChangelog(sourceId, applying);

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
    // Keep last snapshot/changelog + run overview visible.
  }

  async function stopQueue() {
    if (!running || stopping) return;
    abortRef.current = true;
    setStopping(true);
    const activeId = currentSourceIdRef.current;
    if (activeId) {
      try {
        await cancelSourceRefresh(activeId);
      } catch {
        // ignore — local abort still stops the loop
      }
    }
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
          disabled={running}
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
              onClick={() => void startQueue()}
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
                {stopping ? "Stopping…" : "Stop sync"}
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
              active={false}
              disabled={catalogEntries.length === 0}
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
              disabled={selectedCatalog.size === 0}
              onClick={() => setIncludeOptionalPaths(!includeOptionalPathsAll)}
            >
              {includeOptionalPathsAll
                ? "Optional: all"
                : "Optional: main"}
            </FilterBadge>
            <FilterBadge
              active={showFailedMissingDocs}
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
                    const pathBuckets = changelogPathBuckets(
                      changelogs[source.id],
                      startUrls,
                    );
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
                          {status !== "idle" ? (
                            <span
                              className={cn(
                                "shrink-0 rounded-md border px-2 py-0.5 font-mono text-[0.5rem] font-semibold tracking-[0.08em] uppercase",
                                status === "running" &&
                                  "border-accent/40 bg-accent/10 text-accent",
                                status === "queued" &&
                                  "border-border bg-surface-alt text-muted",
                                (status === "updated" ||
                                  status === "up-to-date") &&
                                  "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
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
                running={running}
                errorMessage={
                  activeFocusId ? rowError[activeFocusId] : undefined
                }
                hasLastRun={lastRunIds.length > 0}
              />
            </div>
          </div>

          <div className="shrink-0 border-t border-border bg-surface-alt/95 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-sm">
            <IngestPipelineFlow
              pipeline={pipeline}
              headline={headline}
              variant="banner"
              bannerSize="strip"
              animate={running}
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
                    const rankLabel = String(
                      catalogDisplayRankByPackage.get(entry.package) ?? "—",
                    );
                    return (
                      <li key={entry.package}>
                        <div
                          className={cn(
                            "flex items-center gap-3 px-3 py-2.5 transition-colors",
                            focused && "bg-accent/8",
                          )}
                        >
                          <input
                            type="checkbox"
                            className="size-3.5 shrink-0"
                            checked={checked}
                            onChange={() => toggleCatalog(entry.package)}
                            aria-label={`Select ${entry.package}`}
                          />
                          <span
                            className="w-8 shrink-0 text-right font-mono text-[0.6875rem] font-semibold tabular-nums text-muted"
                            title={`Rank #${rankLabel} (${catalogRankMode})`}
                          >
                            {rankLabel}
                          </span>
                          <button
                            type="button"
                            className="flex min-w-0 flex-1 items-start gap-3 text-left"
                            onClick={() =>
                              setFocusCatalogPackage(entry.package)
                            }
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                                <p className="truncate text-sm font-medium text-foreground">
                                  {entry.package}
                                </p>
                                <span className="rounded-md border border-border bg-surface-alt px-1.5 py-0.5 font-mono text-[0.5rem] font-semibold tracking-[0.08em] text-muted uppercase">
                                  {categoryLabel(entry.category)}
                                </span>
                                {(() => {
                                  const bucket = catalogPathsBucket(entry);
                                  return (
                                    <span
                                      className={cn(
                                        "rounded-md border px-1.5 py-0.5 font-mono text-[0.5rem] font-semibold tracking-[0.08em] uppercase",
                                        bucket === "discovered"
                                          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                                          : bucket === "uncertain"
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
                              <CatalogPathBadges
                                entry={entry}
                                compact
                                selectedUrls={
                                  selectedCatalog.has(entry.package)
                                    ? pathsSetForPackage(entry.package)
                                    : null
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
                            <CatalogMetricChips
                              entry={entry}
                              rankMode={catalogRankMode}
                              layout="stack"
                            />
                          </button>
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
                displayRank={
                  focusCatalogEntry
                    ? (catalogDisplayRankByPackage.get(
                        focusCatalogEntry.package,
                      ) ?? null)
                    : null
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
              animate={false}
              className="w-full"
            />
          </div>
        </div>
      )}
    </div>
  );
}
