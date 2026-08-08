"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw, Square } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import {
  KnowledgeSetScopeToggle,
  type KnowledgeSetScope,
} from "@/components/sources/knowledge-set-scope-toggle";
import { IngestPipelineFlow } from "@/components/sources/ingest-pipeline-flow";
import { Button } from "@/components/ui/button";
import { CachedRemoteImage } from "@/components/sources/cached-remote-image";
import { formatUrlLabel } from "@/components/sources/source-display";
import { pageCatalogPathLabel } from "@/lib/catalog-view";
import { IDLE_INGEST_PIPELINE } from "@/lib/ingest-pipeline";
import {
  pipelineFromRefreshSnapshot,
  refreshHasChanges,
} from "@/lib/admin-source-updater";
import { syncDesktopApiBaseForScope } from "@/lib/desktop-api-routing";
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

export default function AdminSourceUpdaterPage() {
  const { isAdmin } = useAuth();
  const [scope, setScope] = useState<KnowledgeSetScope>("global");
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
      setError(err instanceof Error ? err.message : "Failed to load sources");
      setSources([]);
    }
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    void load(scope);
  }, [isAdmin, load, scope]);

  const activeFocusId = currentSourceId ?? focusSourceId;

  const focusSource = useMemo(
    () => sources?.find((source) => source.id === activeFocusId) ?? null,
    [activeFocusId, sources],
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
    snapshot?.activePath,
    snapshot?.pathIndex,
    snapshot?.pathTotal,
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
    if (running || !sources) return;
    if (selected.size === sources.length) {
      setSelected(new Set());
      return;
    }
    setSelected(new Set(sources.map((source) => source.id)));
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
            const next = { ...prev, [sourceId]: "cancelled" };
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
            const next = { ...prev, [sourceId]: "cancelled" };
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
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">
            Source updater
          </h1>
          <p className="mt-1 text-sm text-muted">
            Pick sets, refresh them one after another, and review page diffs on
            the right.
          </p>
        </div>
        <KnowledgeSetScopeToggle
          value={scope}
          onChange={handleScopeChange}
          disabled={running}
          size="compact"
        />
      </div>

      {error ? (
        <p className="mt-4 text-sm text-red-600 dark:text-red-300">{error}</p>
      ) : null}

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="secondary"
          disabled={running || !sources?.length}
          onClick={toggleAll}
          className="h-8 px-3 text-xs"
        >
          {sources && selected.size === sources.length
            ? "Clear all"
            : "Select all"}
        </Button>
        <Button
          type="button"
          disabled={running || selected.size === 0}
          onClick={() => void startQueue()}
          className="h-8 gap-1.5 px-3 text-xs"
        >
          <RefreshCw className="size-3.5" aria-hidden />
          Update {selected.size > 0 ? selected.size : ""} selected
        </Button>
        {running ? (
          <Button
            type="button"
            variant="secondary"
            disabled={stopping}
            onClick={() => void stopQueue()}
            className="h-8 gap-1.5 border-red-500/40 px-3 text-xs text-red-700 hover:bg-red-500/10 dark:text-red-300"
          >
            <Square className="size-3 fill-current" aria-hidden />
            {stopping ? "Stopping…" : "Stop sync"}
          </Button>
        ) : null}
      </div>

      {sources && lastRunIds.length > 0 ? (
        <div className="mt-4">
          <RunOverview
            runIds={lastRunIds}
            sources={sources}
            rowStatus={rowStatus}
            rowError={rowError}
            changelogs={changelogs}
            running={running}
            stopping={stopping}
            onFocus={setFocusSourceId}
          />
        </div>
      ) : null}

      <div className="mt-4 grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(18rem,0.9fr)]">
        <div className="min-h-0 overflow-y-auto rounded-xl border border-border bg-card-solid">
          {sources === null ? (
            <p className="px-4 py-6 text-sm text-muted">Loading sets…</p>
          ) : sources.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted">No sets in this scope.</p>
          ) : (
            <ul className="divide-y divide-border">
              {sources.map((source) => {
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
                          <div className="flex min-w-0 items-center gap-1.5">
                            <p className="truncate text-sm font-medium text-foreground">
                              {source.name}
                            </p>
                            <CrawlFiltersBadge source={source} />
                          </div>
                          <p className="truncate font-mono text-[0.625rem] text-muted">
                            {formatUrlLabel(source.startUrl || source.name)} ·{" "}
                            {source.pageCount} pages
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
                                    <span className="opacity-80">{total}</span>
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
                            (status === "updated" || status === "up-to-date") &&
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

      <div className="sticky bottom-0 mt-4 border-t border-border bg-surface-alt/95 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-sm">
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
  );
}
