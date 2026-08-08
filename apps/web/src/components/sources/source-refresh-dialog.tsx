"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { pageCatalogPathLabel } from "@/lib/catalog-view";
import {
  applySourceRefresh,
  cancelSourceRefresh,
  dismissSourceRefresh,
  getCrawlProgress,
  getSourceRefreshStatus,
  startSourceRefreshCheck,
  type RefreshChangelog,
  type RefreshRunSnapshot,
} from "@/lib/ledgeindex-api";
import { cn } from "@/lib/utils";

const POLL_MS = 1500;

const panelShellClass =
  "overflow-hidden rounded-xl border border-border bg-card-solid shadow-card";

const panelInsetClass =
  "rounded-xl border border-border bg-surface-raised/60 p-3 sm:p-4";

const sectionLabelClass =
  "font-mono text-[0.5625rem] font-semibold tracking-[0.12em] text-muted uppercase";

const secondaryButtonClass =
  "inline-flex h-7 shrink-0 items-center rounded-md border border-border bg-card-solid px-2.5 font-mono text-[0.5rem] font-semibold tracking-[0.08em] text-muted uppercase transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40";

const primaryButtonClass =
  "inline-flex h-7 shrink-0 items-center rounded-md border border-foreground/15 bg-foreground px-2.5 font-mono text-[0.5rem] font-semibold tracking-[0.08em] text-background uppercase transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40";

function phaseLabel(snapshot: RefreshRunSnapshot): string {
  if (snapshot.status === "discovering") return "Discovering pages";
  if (snapshot.status === "comparing") return "Comparing content";
  if (snapshot.status === "ready") return "Results ready";
  if (snapshot.status === "done") return "Complete";
  if (snapshot.status === "cancelled") return "Cancelled";
  if (snapshot.status === "failed") return "Failed";

  if (snapshot.status === "applying") {
    if (snapshot.phase === "embedding") return "Embedding changed pages";
    if (snapshot.phase === "storing") return "Saving to index";
    return "Re-fetching changed pages";
  }

  return "Fetching pages";
}

function hasChanges(changelog: RefreshChangelog): boolean {
  return (
    changelog.added.length > 0 ||
    changelog.updated.length > 0 ||
    changelog.removed.length > 0
  );
}

function StatusDot({
  status,
}: {
  status: "idle" | "loading" | "ready" | "error";
}) {
  return (
    <span
      className={cn(
        "size-2 shrink-0 rounded-full",
        status === "ready" && "bg-emerald-500",
        status === "loading" && "animate-pulse bg-accent/80",
        status === "idle" && "bg-accent/80",
        status === "error" && "bg-red-500",
      )}
    />
  );
}

function RefreshProgressBar({
  current,
  total,
}: {
  current: number;
  total: number;
}) {
  if (total <= 0) return null;
  const pct = Math.min(100, Math.round((current / total) * 100));

  return (
    <div className="space-y-1.5">
      <span className="block h-1 overflow-hidden rounded-full bg-border/80">
        <span
          className="block h-full rounded-full bg-sky-500 transition-[width] duration-300 ease-out"
          style={{ width: `${pct}%` }}
        />
      </span>
      <p className="font-mono text-[0.5625rem] tabular-nums text-muted">
        {current} / {total}
      </p>
    </div>
  );
}

function InsightPill({
  label,
  emphasized = false,
  tone = "neutral",
}: {
  label: string;
  emphasized?: boolean;
  tone?: "neutral" | "ok" | "added" | "updated" | "removed" | "warn";
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-md border px-2 py-0.5 font-mono text-[0.5rem] font-semibold tracking-[0.08em] uppercase",
        emphasized && "border-accent/25 bg-accent/10 text-accent",
        !emphasized && tone === "neutral" &&
          "border-border bg-surface-raised text-muted",
        tone === "ok" &&
          "border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
        tone === "added" &&
          "border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
        tone === "updated" &&
          "border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-400",
        tone === "removed" &&
          "border-red-500/35 bg-red-500/10 text-red-700 dark:text-red-300",
        tone === "warn" &&
          "border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-400",
      )}
    >
      {label}
    </span>
  );
}

function RefreshStatusPanel({
  tone,
  title,
  description,
  actionHint,
  children,
}: {
  tone: "info" | "success" | "changes";
  title: string;
  description: string;
  actionHint: string;
  children?: ReactNode;
}) {
  const iconClass =
    tone === "success"
      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
      : tone === "changes"
        ? "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400"
        : "border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-400";

  const titleClass =
    tone === "success"
      ? "text-emerald-600 dark:text-emerald-400"
      : tone === "changes"
        ? "text-amber-600 dark:text-amber-400"
        : "text-sky-600 dark:text-sky-400";

  return (
    <div className={panelInsetClass}>
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-full border",
            iconClass,
          )}
        >
          {tone === "success" ? (
            <CheckIcon className="size-4" />
          ) : tone === "changes" ? (
            <ChangesIcon className="size-4" />
          ) : (
            <SnapshotIcon className="size-4" />
          )}
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <p
              className={cn(
                "font-mono text-[0.5625rem] font-semibold tracking-[0.12em] uppercase",
                titleClass,
              )}
            >
              {title}
            </p>
            <InsightPill
              label={actionHint}
              tone={
                tone === "success"
                  ? "ok"
                  : tone === "changes"
                    ? "warn"
                    : "neutral"
              }
              emphasized={tone === "info"}
            />
          </div>
          <p className="text-[0.6875rem] leading-5 text-muted">{description}</p>
        </div>
      </div>
      {children ? <div className="mt-4 space-y-3">{children}</div> : null}
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

function SnapshotIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <path d="m21 15-5-5L5 21" />
    </svg>
  );
}

function ChangesIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 6v6l4 2" />
      <circle cx="12" cy="12" r="10" />
    </svg>
  );
}

function ChangelogSection({
  label,
  pages,
  tone,
}: {
  label: string;
  pages: Array<{ url: string; title: string }>;
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
    <section className="space-y-2">
      <p className={cn(sectionLabelClass, toneClass)}>
        {label} · {pages.length}
      </p>
      <ul className="max-h-36 divide-y divide-border overflow-y-auto rounded-xl border border-border bg-background">
        {pages.map((page) => (
          <li key={page.url} className="min-w-0 px-3 py-2">
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

export function SourceRefreshDialog({
  sourceId,
  sourceName,
  sourceStartUrl,
  sourceScope = "personal",
  open,
  onOpenChange,
  onApplied,
}: {
  sourceId: string;
  sourceName: string;
  sourceStartUrl: string;
  sourceScope?: "personal" | "global";
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApplied?: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [snapshot, setSnapshot] = useState<RefreshRunSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [discoverCount, setDiscoverCount] = useState(0);
  const startedRef = useRef(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const refreshStatus = useCallback(async () => {
    const { snapshot: next } = await getSourceRefreshStatus(sourceId);
    setSnapshot(next);
    return next;
  }, [sourceId]);

  useEffect(() => {
    if (!open) {
      startedRef.current = false;
      setSnapshot(null);
      setError(null);
      setBusy(false);
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const existing = await refreshStatus();
        if (cancelled) return;

        if (
          existing &&
          (existing.status === "discovering" ||
            existing.status === "parsing" ||
            existing.status === "comparing" ||
            existing.status === "applying")
        ) {
          return;
        }

        if (startedRef.current) return;
        startedRef.current = true;
        setBusy(true);
        const { snapshot: started } = await startSourceRefreshCheck(
          sourceId,
          "discover",
        );
        if (!cancelled) setSnapshot(started);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to start check");
        }
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, refreshStatus, sourceId]);

  useEffect(() => {
    if (!open || !snapshot) return;
    if (
      snapshot.status !== "discovering" &&
      snapshot.status !== "parsing" &&
      snapshot.status !== "comparing" &&
      snapshot.status !== "applying"
    ) {
      return;
    }

    const timer = window.setInterval(() => {
      void refreshStatus().catch(() => undefined);
      if (snapshot.status === "discovering" || snapshot.mode === "discover") {
        void getCrawlProgress(sourceId)
          .then((progress) => {
            if (progress.active) {
              setDiscoverCount(progress.pagesDiscovered);
            }
          })
          .catch(() => undefined);
      }
    }, POLL_MS);

    return () => window.clearInterval(timer);
  }, [open, refreshStatus, snapshot?.mode, snapshot?.status, sourceId]);

  const changelog = snapshot?.changelog;
  const isRunning =
    snapshot?.status === "discovering" ||
    snapshot?.status === "parsing" ||
    snapshot?.status === "comparing" ||
    snapshot?.status === "applying";
  const activeMode = snapshot?.mode ?? "discover";
  const reviewSelectionHref = `/sources/web-crawl?url=${encodeURIComponent(sourceStartUrl)}${
    sourceScope === "global" ? "&scope=global" : ""
  }&mode=refresh-select&sourceId=${encodeURIComponent(sourceId)}`;
  const showReviewSelection =
    snapshot?.status === "ready" &&
    activeMode === "discover" &&
    changelog &&
    (changelog.added.length > 0 ||
      changelog.removed.length > 0 ||
      changelog.updated.length > 0);
  const headerStatus: "idle" | "loading" | "ready" | "error" =
    error || snapshot?.error || snapshot?.status === "failed"
      ? "error"
      : isRunning || busy
        ? "loading"
        : snapshot?.status === "ready" || snapshot?.status === "done"
          ? "ready"
          : "idle";

  async function handleCancel() {
    setBusy(true);
    setError(null);
    try {
      await cancelSourceRefresh(sourceId);
      await refreshStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to cancel");
    } finally {
      setBusy(false);
    }
  }

  async function handleDismiss() {
    setBusy(true);
    setError(null);
    try {
      await dismissSourceRefresh(sourceId);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to dismiss");
    } finally {
      setBusy(false);
    }
  }

  async function handleApply() {
    setBusy(true);
    setError(null);
    try {
      await refreshStatus();
      const { snapshot: applied } = await applySourceRefresh(sourceId);
      setSnapshot(applied);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to apply changes");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (snapshot?.status === "done") {
      onApplied?.();
    }
  }, [onApplied, snapshot?.status]);

  return (
    <dialog
      ref={dialogRef}
      className={cn(
        "fixed inset-0 z-50 m-auto w-[min(40rem,calc(100vw-2rem))] max-h-[min(85vh,48rem)] overflow-hidden p-0 text-foreground backdrop:bg-black/60",
        panelShellClass,
      )}
      onClose={() => onOpenChange(false)}
    >
      <div className="flex max-h-[min(85vh,48rem)] flex-col">
        <header className="relative flex min-w-0 shrink-0 items-center gap-2 border-b border-border bg-surface-raised px-3 py-2 sm:gap-3 sm:px-4">
          <StatusDot status={headerStatus} />
          <div className="min-w-0 flex-1">
            <p className={sectionLabelClass}>Check updates</p>
            <p className="truncate font-mono text-[0.6875rem] text-muted-strong">
              {sourceName}
            </p>
            <p className="mt-0.5 text-[0.6875rem] leading-5 text-muted">
              Crawl the site again, then diff URLs and content against the index.
            </p>
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className={secondaryButtonClass}
          >
            Close
          </button>
        </header>

        <div className="flex-1 space-y-3 overflow-y-auto px-3 py-3 sm:space-y-4 sm:px-4 sm:py-4">
          {error ? (
            <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 font-mono text-[0.6875rem] text-red-700 dark:text-red-200">
              {error}
            </p>
          ) : null}

          {snapshot?.error ? (
            <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 font-mono text-[0.6875rem] text-red-700 dark:text-red-200">
              {snapshot.error}
            </p>
          ) : null}

          {isRunning || busy ? (
            <div className={panelInsetClass}>
              <div className="flex items-center gap-3">
                <StatusDot status="loading" />
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-[0.5625rem] font-semibold tracking-[0.12em] text-accent uppercase">
                    {snapshot ? phaseLabel(snapshot) : "Starting check"}
                  </p>
                  <p className="mt-0.5 text-[0.6875rem] leading-5 text-muted">
                    {snapshot?.status === "discovering"
                      ? "Running a fresh crawl with your source config."
                      : "Comparing live pages against the last indexed snapshot."}
                  </p>
                </div>
              </div>
              {snapshot?.status === "discovering" ? (
                <div className="mt-4 space-y-1.5">
                  <RefreshProgressBar
                    current={discoverCount || snapshot.current}
                    total={snapshot.total || 1}
                  />
                  <p className="font-mono text-[0.5625rem] text-muted">
                    {discoverCount || snapshot.current} pages discovered
                  </p>
                </div>
              ) : snapshot && snapshot.total > 0 ? (
                <div className="mt-4">
                  <RefreshProgressBar
                    current={snapshot.current}
                    total={snapshot.total}
                  />
                </div>
              ) : (
                <p className="mt-4 font-mono text-[0.5625rem] text-muted">
                  Preparing…
                </p>
              )}
            </div>
          ) : null}

          {snapshot?.status === "ready" && changelog ? (
            <div className="space-y-3 sm:space-y-4">
              {changelog.baselineCaptured ? (
                <RefreshStatusPanel
                  tone="info"
                  title="Baseline snapshot saved"
                  description="Content hashes stored for indexed pages. Future checks compare against this baseline."
                  actionHint="No action needed"
                >
                  <div className="flex flex-wrap gap-1.5">
                    <InsightPill
                      label={`${changelog.added.length} snapshotted`}
                      tone="ok"
                    />
                  </div>
                  <p className="rounded-xl border border-border bg-background px-3 py-2 text-[0.6875rem] leading-5 text-muted">
                    Index is already up to date. Run check again after the site
                    changes to see a diff.
                  </p>
                </RefreshStatusPanel>
              ) : !hasChanges(changelog) ? (
                <RefreshStatusPanel
                  tone="success"
                  title="Everything matches"
                  description="Live pages match the last indexed snapshot."
                  actionHint="No re-index needed"
                >
                  <div className="flex flex-wrap gap-1.5">
                    <InsightPill
                      label={`${changelog.unchangedCount} unchanged`}
                      tone="ok"
                    />
                  </div>
                </RefreshStatusPanel>
              ) : (
                <>
                  <RefreshStatusPanel
                    tone="changes"
                    title="Changes detected"
                    description="Review the diff below. Apply only if you want the index updated."
                    actionHint="Action required"
                  >
                    <div className="flex flex-wrap gap-1.5">
                      <InsightPill
                        label={`${changelog.unchangedCount} unchanged`}
                      />
                      <InsightPill
                        label={`${changelog.added.length} added`}
                        tone="added"
                      />
                      <InsightPill
                        label={`${changelog.updated.length} updated`}
                        tone="updated"
                      />
                      <InsightPill
                        label={`${changelog.removed.length} removed`}
                        tone="removed"
                      />
                    </div>
                  </RefreshStatusPanel>
                  <ChangelogSection
                    label="Added"
                    pages={changelog.added}
                    tone="added"
                  />
                  <ChangelogSection
                    label="Updated"
                    pages={changelog.updated}
                    tone="updated"
                  />
                  <ChangelogSection
                    label="Removed"
                    pages={changelog.removed}
                    tone="removed"
                  />
                </>
              )}
            </div>
          ) : null}

          {snapshot?.status === "done" ? (
            <RefreshStatusPanel
              tone="success"
              title="Index updated"
              description="Changed pages were re-indexed and removed pages were cleared from the index."
              actionHint="Done"
            />
          ) : null}

          {snapshot?.status === "cancelled" ? (
            <p className="font-mono text-[0.6875rem] text-muted">
              Refresh check was cancelled.
            </p>
          ) : null}
        </div>

        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-x-2 gap-y-1 border-t border-border px-3 py-1.5 sm:gap-x-3 sm:px-4 sm:py-2">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            {snapshot?.status === "ready" && changelog ? (
              changelog.baselineCaptured || !hasChanges(changelog) ? (
                <InsightPill label="No re-index needed" tone="ok" />
              ) : (
                <InsightPill label="Apply to update index" tone="warn" />
              )
            ) : isRunning ? (
              <InsightPill
                label={
                  snapshot?.status === "discovering"
                    ? "Discovery running"
                    : "Check in progress"
                }
                emphasized
              />
            ) : null}
          </div>

          <div className="flex flex-wrap items-center justify-end gap-1.5">
            {showReviewSelection ? (
              <Link
                href={reviewSelectionHref}
                className={secondaryButtonClass}
                onClick={() => onOpenChange(false)}
              >
                Review selection
              </Link>
            ) : null}
            {isRunning ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleCancel()}
                className={secondaryButtonClass}
              >
                Stop
              </button>
            ) : null}

            {snapshot?.status === "ready" && changelog ? (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleDismiss()}
                  className={
                    changelog.baselineCaptured || !hasChanges(changelog)
                      ? primaryButtonClass
                      : secondaryButtonClass
                  }
                >
                  {changelog.baselineCaptured || !hasChanges(changelog)
                    ? "Done"
                    : "Dismiss"}
                </button>
                {!changelog.baselineCaptured && hasChanges(changelog) ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void handleApply()}
                    className={primaryButtonClass}
                  >
                    Apply changes
                  </button>
                ) : null}
              </>
            ) : null}

            {snapshot?.status === "done" ||
            snapshot?.status === "cancelled" ||
            snapshot?.status === "failed" ? (
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className={primaryButtonClass}
              >
                Close
              </button>
            ) : null}
          </div>
        </footer>
      </div>
    </dialog>
  );
}
