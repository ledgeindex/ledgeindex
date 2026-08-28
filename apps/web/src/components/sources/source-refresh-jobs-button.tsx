"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { RefreshCw } from "lucide-react";
import {
  isRefreshRunBusy,
  refreshHasChanges,
  RefreshStatusDot,
  refreshPhaseLabel,
  SourceRefreshJobView,
} from "@/components/sources/source-refresh-view";
import { useOptionalSourceRefreshJobs } from "@/contexts/source-refresh-jobs-context";
import { cn } from "@/lib/utils";

export function SourceRefreshJobsButton({
  className,
}: {
  className?: string;
}) {
  const jobsContext = useOptionalSourceRefreshJobs();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const jobs = jobsContext?.jobs ?? [];
  const panelOpen = jobsContext?.panelOpen ?? false;
  const selectedSourceId = jobsContext?.selectedSourceId ?? null;
  const runningCount = jobsContext?.runningCount ?? 0;
  const readyCount = jobsContext?.readyCount ?? 0;
  const openPanel = jobsContext?.openPanel;
  const closePanel = jobsContext?.closePanel;
  const selectJob = jobsContext?.selectJob;
  const cancelJob = jobsContext?.cancelJob;
  const dismissJob = jobsContext?.dismissJob;
  const applyJob = jobsContext?.applyJob;

  const selected =
    jobs.find((job) => job.sourceId === selectedSourceId) ?? jobs[0] ?? null;
  const visible = jobs.length > 0;
  const headerStatus: "idle" | "loading" | "ready" | "error" =
    jobs.some((job) => job.snapshot?.status === "failed" || job.error)
      ? "error"
      : runningCount > 0
        ? "loading"
        : readyCount > 0
          ? "ready"
          : "idle";

  useEffect(() => {
    if (!panelOpen) return;

    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node | null;
      if (!target) return;
      if (buttonRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      closePanel?.();
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") closePanel?.();
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [closePanel, panelOpen]);

  if (!jobsContext || (!visible && !panelOpen)) return null;

  const badge = runningCount + readyCount;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => (panelOpen ? closePanel?.() : openPanel?.(selected?.sourceId))}
        title={
          runningCount > 0
            ? `${runningCount} source update${runningCount === 1 ? "" : "s"} running`
            : readyCount > 0
              ? `${readyCount} update${readyCount === 1 ? "" : "s"} ready to apply`
              : "Source updates"
        }
        aria-label="Source updates"
        aria-expanded={panelOpen}
        className={cn(
          "relative inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-card-solid px-2 text-muted transition-colors",
          "hover:bg-surface-raised hover:text-foreground",
          panelOpen && "border-foreground/20 text-foreground",
          className,
        )}
      >
        <RefreshCw
          className={cn("size-3.5", runningCount > 0 && "animate-spin")}
          aria-hidden
        />
        <span className="hidden font-mono text-[0.625rem] uppercase tracking-wide sm:inline">
          {runningCount > 0 ? "Updating" : readyCount > 0 ? "Apply" : "Updates"}
        </span>
        {badge > 0 ? (
          <span className="inline-flex min-w-4 items-center justify-center rounded-full bg-accent/20 px-1 font-mono text-[0.5625rem] font-semibold text-accent">
            {badge}
          </span>
        ) : null}
      </button>

      {panelOpen
        ? createPortal(
            <div
              ref={panelRef}
              className="fixed right-3 top-14 z-[420] flex w-[min(28rem,calc(100vw-1.5rem))] max-h-[min(85vh,44rem)] flex-col overflow-hidden rounded-xl border border-border bg-card-solid shadow-card [-webkit-app-region:no-drag]"
              role="dialog"
              aria-label="Source updates"
            >
              <header className="flex shrink-0 items-center gap-2 border-b border-border bg-surface-raised px-3 py-2">
                <RefreshStatusDot status={headerStatus} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[0.8125rem] font-semibold text-foreground">
                    {jobs.length === 1 && selected
                      ? selected.sourceName
                      : "Source updates"}
                  </p>
                  {jobs.length > 1 && runningCount > 0 ? (
                    <p className="truncate text-[0.6875rem] text-muted">
                      {runningCount} running
                    </p>
                  ) : jobs.length === 1 &&
                    readyCount > 0 &&
                    runningCount === 0 ? (
                    <p className="truncate text-[0.6875rem] text-muted">
                      Review the diff
                    </p>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => closePanel?.()}
                  className="inline-flex h-7 shrink-0 items-center rounded-md border border-border bg-card-solid px-2.5 font-mono text-[0.5rem] font-semibold tracking-[0.08em] text-muted uppercase hover:text-foreground"
                >
                  Close
                </button>
              </header>

              {jobs.length > 1 ? (
                <ul className="shrink-0 divide-y divide-border border-b border-border">
                  {jobs.map((job) => {
                    const active = job.sourceId === selected?.sourceId;
                    const running = isRefreshRunBusy(job.snapshot?.status);
                    const needsApply =
                      job.snapshot?.status === "ready" &&
                      job.snapshot.changelog &&
                      !job.snapshot.changelog.baselineCaptured &&
                      refreshHasChanges(job.snapshot.changelog);
                    return (
                      <li key={job.sourceId}>
                        <button
                          type="button"
                          onClick={() => selectJob?.(job.sourceId)}
                          className={cn(
                            "flex w-full items-center gap-2 px-3 py-2 text-left",
                            active
                              ? "bg-surface-raised"
                              : "hover:bg-surface-raised/60",
                          )}
                        >
                          <RefreshStatusDot
                            status={
                              job.error || job.snapshot?.status === "failed"
                                ? "error"
                                : running
                                  ? "loading"
                                  : needsApply
                                    ? "ready"
                                    : "idle"
                            }
                          />
                          <span className="min-w-0 flex-1 truncate text-[0.75rem] font-medium text-foreground">
                            {job.sourceName}
                          </span>
                          <span className="shrink-0 font-mono text-[0.5rem] tracking-[0.08em] text-muted uppercase">
                            {job.snapshot
                              ? refreshPhaseLabel(job.snapshot)
                              : "Starting"}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : null}

              {selected ? (
                <SourceRefreshJobView
                  sourceId={selected.sourceId}
                  sourceName={selected.sourceName}
                  sourceStartUrl={selected.sourceStartUrl}
                  sourceScope={selected.sourceScope}
                  snapshot={selected.snapshot}
                  discoverCount={selected.discoverCount}
                  busy={selected.busy}
                  error={selected.error}
                  onCancel={() => void cancelJob?.(selected.sourceId)}
                  onDismiss={() => void dismissJob?.(selected.sourceId)}
                  onApply={() => void applyJob?.(selected.sourceId)}
                />
              ) : (
                <p className="px-3 py-6 text-center text-sm text-muted">
                  No source updates right now.
                </p>
              )}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
