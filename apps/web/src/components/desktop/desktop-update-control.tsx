"use client";

import { ArrowDownToLine, Download, RefreshCw, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  useLedgeIndexDesktop,
  type DesktopUpdateEvent,
} from "@/lib/ledgeindex-desktop";
import { cn } from "@/lib/utils";

function notesToText(notes: string | string[] | null | undefined): string {
  if (!notes) return "No release notes for this version.";
  if (Array.isArray(notes)) return notes.filter(Boolean).join("\n\n");
  return notes;
}

export function DesktopUpdateControl() {
  const desktop = useLedgeIndexDesktop();
  const [open, setOpen] = useState(false);
  const [checking, setChecking] = useState(false);
  const [available, setAvailable] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [version, setVersion] = useState<string | null>(null);
  const [releaseName, setReleaseName] = useState<string | null>(null);
  const [releaseNotes, setReleaseNotes] = useState<string | null>(null);
  const [currentVersion, setCurrentVersion] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!desktop?.getAppVersion) return;
    void desktop.getAppVersion().then(setCurrentVersion);
  }, [desktop]);

  useEffect(() => {
    if (!desktop?.onUpdateEvent) return;
    return desktop.onUpdateEvent((payload: DesktopUpdateEvent) => {
      switch (payload.type) {
        case "checking-for-update":
          setChecking(true);
          setError(null);
          break;
        case "update-available":
          setChecking(false);
          setAvailable(true);
          setVersion(payload.info?.version ?? null);
          setReleaseName(payload.info?.releaseName ?? payload.info?.version ?? null);
          setReleaseNotes(notesToText(payload.info?.releaseNotes));
          break;
        case "update-not-available":
          setChecking(false);
          setAvailable(false);
          break;
        case "download-progress":
          setDownloading(true);
          setProgress(payload.progress?.percent ?? 0);
          break;
        case "update-downloaded":
          setDownloading(false);
          setDownloaded(true);
          setProgress(null);
          break;
        case "error":
          setChecking(false);
          setDownloading(false);
          setProgress(null);
          setError(payload.error ?? "Update failed");
          break;
        default:
          break;
      }
    });
  }, [desktop]);

  const onOpen = useCallback(() => {
    setOpen(true);
    if (!available && desktop?.checkForUpdates) {
      setChecking(true);
      void desktop.checkForUpdates();
    }
  }, [available, desktop]);

  const onDownloadOrInstall = useCallback(() => {
    if (!desktop) return;
    if (downloaded) {
      void desktop.installUpdate?.();
      return;
    }
    if (available && !downloading) {
      setDownloading(true);
      setProgress(0);
      void desktop.downloadUpdate?.();
    }
  }, [available, desktop, downloaded, downloading]);

  const statusLabel = useMemo(() => {
    if (downloaded) return "Ready to restart";
    if (downloading) return `Downloading… ${Math.round(progress ?? 0)}%`;
    if (available) return "Update available";
    if (checking) return "Checking…";
    return "Up to date";
  }, [available, checking, downloaded, downloading, progress]);

  if (!desktop?.checkForUpdates) return null;

  // Only show the header badge when an update exists (or download in flight).
  const showBadge = available || downloading || downloaded;

  return (
    <>
      {showBadge ? (
        <button
          type="button"
          onClick={onOpen}
          className={cn(
            "relative inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md",
            "border border-emerald-500/40 bg-emerald-500/12 text-emerald-800",
            "[-webkit-app-region:no-drag] hover:bg-emerald-500/20 dark:text-emerald-200",
          )}
          title={statusLabel}
          aria-label={statusLabel}
        >
          <ArrowDownToLine className="size-3.5" />
          <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-emerald-500" />
        </button>
      ) : null}

      {open
        ? createPortal(
            <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 [-webkit-app-region:no-drag]">
              <button
                type="button"
                className="absolute inset-0 bg-black/40"
                aria-label="Close"
                onClick={() => setOpen(false)}
              />
              <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="desktop-update-title"
                className="relative z-10 w-full max-w-md rounded-xl border border-border bg-card-solid p-5 shadow-xl"
              >
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div>
                    <h2
                      id="desktop-update-title"
                      className="text-base font-semibold text-foreground"
                    >
                      {available || downloaded ? "Update available" : "App updates"}
                    </h2>
                    <p className="mt-1 font-mono text-[0.6875rem] text-muted">
                      Current {currentVersion ?? "…"}
                      {version ? ` → ${version}` : ""}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="inline-flex size-8 items-center justify-center rounded-md text-muted hover:bg-surface-raised hover:text-foreground"
                    onClick={() => setOpen(false)}
                    aria-label="Close"
                  >
                    <X className="size-4" />
                  </button>
                </div>

                {releaseName ? (
                  <p className="mb-2 text-sm font-medium text-foreground">
                    {releaseName}
                  </p>
                ) : null}

                <div className="mb-4 max-h-48 overflow-y-auto rounded-lg border border-border/80 bg-surface-alt p-3">
                  <pre className="whitespace-pre-wrap font-sans text-xs leading-relaxed text-muted">
                    {releaseNotes ??
                      (checking
                        ? "Checking for updates…"
                        : "No update details yet. Check again when a release is published.")}
                  </pre>
                </div>

                {typeof progress === "number" ? (
                  <div className="mb-4">
                    <div className="mb-1 flex justify-between font-mono text-[0.625rem] text-muted">
                      <span>Download</span>
                      <span>{Math.round(progress)}%</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-surface-raised">
                      <div
                        className="h-full bg-emerald-500 transition-[width]"
                        style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
                      />
                    </div>
                  </div>
                ) : null}

                {error ? (
                  <p className="mb-3 text-xs text-red-600 dark:text-red-400">{error}</p>
                ) : null}

                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm text-muted hover:bg-surface-raised hover:text-foreground"
                    onClick={() => {
                      setChecking(true);
                      setError(null);
                      void desktop.checkForUpdates?.();
                    }}
                    disabled={checking || downloading}
                  >
                    <RefreshCw className={cn("size-3.5", checking && "animate-spin")} />
                    Check
                  </button>
                  {(available || downloaded) && (
                    <button
                      type="button"
                      className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-foreground px-3 text-sm font-medium text-background hover:opacity-90 disabled:opacity-50"
                      onClick={onDownloadOrInstall}
                      disabled={downloading && !downloaded}
                    >
                      {downloaded ? (
                        <>
                          <ArrowDownToLine className="size-3.5" />
                          Restart & install
                        </>
                      ) : (
                        <>
                          <Download className="size-3.5" />
                          Update now
                        </>
                      )}
                    </button>
                  )}
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
