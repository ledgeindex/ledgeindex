"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  KnowledgeIndexApiError,
  listSitemapPages,
  probeUrlStatuses,
} from "@/lib/ledgeindex-api";
import { cn } from "@/lib/utils";

export type SitemapSelectCandidate = {
  url: string;
  reachable: boolean;
};

const PAGE_SIZE = 50;
/**
 * HEAD (or tiny GET fallback) is cheap. Match discover’s status probe (~12).
 * Batch size is API payload size; concurrency is the real rate limit.
 */
const PROBE_BATCH = 100;
const PROBE_CONCURRENCY = 12;

type UrlStatus = {
  ok: boolean;
  status: number | null;
  reason?: string;
};

export function SitemapSelectModal({
  open,
  candidates,
  selectedUrls,
  primarySitemapUrl,
  onCancel,
  onApply,
}: {
  open: boolean;
  candidates: SitemapSelectCandidate[];
  /** Currently configured custom sitemap URLs. */
  selectedUrls: string[];
  /** Preflight's preferred sitemap when no custom selection exists. */
  primarySitemapUrl?: string | null;
  onCancel: () => void;
  onApply: (urls: string[]) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [customUrl, setCustomUrl] = useState("");
  const [pageUrls, setPageUrls] = useState<string[]>([]);
  const [pagesLoading, setPagesLoading] = useState(false);
  const [pagesError, setPagesError] = useState<string | null>(null);
  const [pagesTruncated, setPagesTruncated] = useState(false);
  const [pageIndex, setPageIndex] = useState(0);
  const [statusByUrl, setStatusByUrl] = useState<Record<string, UrlStatus>>({});
  const [probeRunning, setProbeRunning] = useState(false);
  const [probeDone, setProbeDone] = useState(0);
  const [probeTotal, setProbeTotal] = useState(0);
  const [probeError, setProbeError] = useState<string | null>(null);
  const [errorsOnly, setErrorsOnly] = useState(false);
  const probeAbortRef = useRef<AbortController | null>(null);

  const rows = useMemo(() => {
    const byUrl = new Map<string, SitemapSelectCandidate>();
    for (const row of candidates) {
      byUrl.set(row.url, row);
    }
    for (const url of selectedUrls) {
      if (!byUrl.has(url)) {
        byUrl.set(url, { url, reachable: true });
      }
    }
    if (customUrl.trim()) {
      try {
        const normalized = new URL(customUrl.trim()).href;
        if (!byUrl.has(normalized)) {
          byUrl.set(normalized, { url: normalized, reachable: true });
        }
      } catch {
        // ignore invalid while typing
      }
    }
    return [...byUrl.values()].sort((a, b) => {
      if (a.reachable !== b.reachable) return a.reachable ? -1 : 1;
      return a.url.localeCompare(b.url);
    });
  }, [candidates, selectedUrls, customUrl]);

  const selectedList = useMemo(() => [...selected].sort(), [selected]);

  const displayUrls = useMemo(() => {
    if (!errorsOnly) return pageUrls;
    return pageUrls.filter((url) => {
      const entry = statusByUrl[url];
      return entry != null && !entry.ok;
    });
  }, [pageUrls, errorsOnly, statusByUrl]);

  const statusSummary = useMemo(() => {
    let okCount = 0;
    let nonOkCount = 0;
    let checked = 0;
    for (const url of pageUrls) {
      const entry = statusByUrl[url];
      if (!entry) continue;
      checked += 1;
      if (entry.ok) okCount += 1;
      else nonOkCount += 1;
    }
    return { okCount, nonOkCount, checked };
  }, [pageUrls, statusByUrl]);

  const pageCount = Math.max(1, Math.ceil(displayUrls.length / PAGE_SIZE));
  const safePage = Math.min(pageIndex, pageCount - 1);
  const pageSlice = displayUrls.slice(
    safePage * PAGE_SIZE,
    safePage * PAGE_SIZE + PAGE_SIZE,
  );

  useEffect(() => {
    if (!open) return;
    if (selectedUrls.length > 0) {
      setSelected(new Set(selectedUrls));
      return;
    }
    if (primarySitemapUrl) {
      setSelected(new Set([primarySitemapUrl]));
      return;
    }
    const firstReachable = candidates.find((row) => row.reachable)?.url;
    setSelected(firstReachable ? new Set([firstReachable]) : new Set());
  }, [open, selectedUrls, primarySitemapUrl, candidates]);

  useEffect(() => {
    if (!open) return;
    if (selectedList.length === 0) {
      setPageUrls([]);
      setPagesError(null);
      setPagesTruncated(false);
      setPageIndex(0);
      setStatusByUrl({});
      setProbeDone(0);
      setProbeTotal(0);
      setProbeError(null);
      setErrorsOnly(false);
      return;
    }

    let cancelled = false;
    setPagesLoading(true);
    setPagesError(null);
    setPageIndex(0);
    setStatusByUrl({});
    setProbeDone(0);
    setProbeTotal(0);
    setProbeError(null);
    setErrorsOnly(false);

    void listSitemapPages({ sitemapUrls: selectedList })
      .then((result) => {
        if (cancelled) return;
        setPageUrls(result.urls);
        setPagesTruncated(Boolean(result.truncated));
      })
      .catch((err) => {
        if (cancelled) return;
        const message =
          err instanceof KnowledgeIndexApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : "Failed to load sitemap pages";
        setPagesError(message);
        setPageUrls([]);
      })
      .finally(() => {
        if (!cancelled) setPagesLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, selectedList.join("\n")]);

  useEffect(() => {
    if (open) return;
    probeAbortRef.current?.abort();
    probeAbortRef.current = null;
  }, [open]);

  if (!open) return null;

  function toggle(url: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
  }

  function addCustom() {
    const raw = customUrl.trim();
    if (!raw) return;
    try {
      const normalized = new URL(raw).href;
      setSelected((current) => new Set(current).add(normalized));
      setCustomUrl("");
    } catch {
      // keep input for correction
    }
  }

  async function runStatusProbe() {
    if (pageUrls.length === 0 || probeRunning) return;

    const toProbe = pageUrls;
    if (toProbe.length >= 400) {
      const ok = window.confirm(
        `Check HTTP status for ${toProbe.length} URL${toProbe.length === 1 ? "" : "s"}?\n\nHEAD probes only (~${PROBE_CONCURRENCY} at a time). Starts when you confirm.`,
      );
      if (!ok) return;
    }

    probeAbortRef.current?.abort();
    const controller = new AbortController();
    probeAbortRef.current = controller;

    setProbeRunning(true);
    setProbeError(null);
    setProbeDone(0);
    setProbeTotal(toProbe.length);
    setStatusByUrl({});
    setErrorsOnly(false);

    try {
      for (let start = 0; start < toProbe.length; start += PROBE_BATCH) {
        if (controller.signal.aborted) break;
        const batch = toProbe.slice(start, start + PROBE_BATCH);
        const probe = await probeUrlStatuses({
          urls: batch,
          concurrency: PROBE_CONCURRENCY,
        });
        if (controller.signal.aborted) break;
        setStatusByUrl((current) => {
          const next = { ...current };
          for (const row of probe.results) {
            next[row.url] = {
              ok: row.ok,
              status: row.status,
              reason: row.reason,
            };
          }
          return next;
        });
        setProbeDone((current) =>
          Math.min(toProbe.length, current + batch.length),
        );
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      setProbeError(
        err instanceof KnowledgeIndexApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Status probe failed",
      );
    } finally {
      if (probeAbortRef.current === controller) {
        probeAbortRef.current = null;
      }
      setProbeRunning(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="sitemap-select-title"
        className="flex max-h-[min(40rem,92dvh)] w-full max-w-2xl flex-col rounded-xl border border-border bg-card-solid shadow-card"
      >
        <div className="border-b border-border px-5 py-4">
          <h2
            id="sitemap-select-title"
            className="text-base font-semibold text-foreground"
          >
            Choose sitemaps
          </h2>
          <p className="mt-2 text-[0.8125rem] leading-snug text-muted">
            Scope include/exclude patterns still apply to every page URL from
            these sitemaps during crawl.
          </p>
        </div>

        <div className="grid min-h-0 flex-1 gap-0 overflow-hidden md:grid-cols-2">
          <div className="flex min-h-0 flex-col border-b border-border md:border-r md:border-b-0">
            <p className="shrink-0 px-4 pt-3 font-mono text-[0.5625rem] font-semibold tracking-[0.08em] text-muted uppercase">
              Sitemap files
            </p>
            <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 py-2">
              {rows.length === 0 ? (
                <li className="px-2 py-6 text-center text-sm text-muted">
                  No sitemap candidates yet. Run Check site first, or add a URL
                  below.
                </li>
              ) : (
                rows.map((row) => {
                  const checked = selected.has(row.url);
                  return (
                    <li key={row.url}>
                      <label
                        className={cn(
                          "flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors",
                          checked
                            ? "border-accent/40 bg-accent-soft"
                            : "border-border hover:bg-surface-raised",
                          !row.reachable && "opacity-60",
                        )}
                      >
                        <input
                          type="checkbox"
                          className="mt-1"
                          checked={checked}
                          onChange={() => toggle(row.url)}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-mono text-[0.75rem] text-foreground">
                            {row.url}
                          </span>
                          <span className="mt-0.5 block font-mono text-[0.5625rem] tracking-[0.06em] text-muted uppercase">
                            {row.reachable ? "Reachable" : "Not reachable"}
                          </span>
                        </span>
                      </label>
                    </li>
                  );
                })
              )}
            </ul>
          </div>

          <div className="flex min-h-0 flex-col">
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 px-4 pt-3">
              <p className="font-mono text-[0.5625rem] font-semibold tracking-[0.08em] text-muted uppercase">
                Page URLs
                {pageUrls.length > 0 ? ` · ${pageUrls.length}` : ""}
                {pagesTruncated ? "+" : ""}
                {probeRunning ? (
                  <> · Checking {probeDone}/{probeTotal || pageUrls.length}</>
                ) : statusSummary.checked > 0 ? (
                  <>
                    {" · "}
                    <span>{statusSummary.okCount} ok</span>
                    {" · "}
                    <button
                      type="button"
                      disabled={statusSummary.nonOkCount === 0}
                      onClick={() => {
                        setErrorsOnly((current) => !current);
                        setPageIndex(0);
                      }}
                      className={cn(
                        "underline-offset-2 transition-colors",
                        statusSummary.nonOkCount === 0
                          ? "cursor-default"
                          : "underline hover:text-foreground",
                        errorsOnly &&
                          "text-red-700 dark:text-red-300",
                      )}
                      title={
                        statusSummary.nonOkCount > 0
                          ? errorsOnly
                            ? "Show all URLs"
                            : "Show only non-2xx URLs"
                          : undefined
                      }
                    >
                      {statusSummary.nonOkCount} non-2xx
                    </button>
                  </>
                ) : null}
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={
                    pagesLoading ||
                    probeRunning ||
                    pageUrls.length === 0 ||
                    Boolean(pagesError)
                  }
                  onClick={() => void runStatusProbe()}
                  title="On demand only. HEAD probes (~12 concurrent)."
                  className="rounded-md border border-border px-1.5 py-0.5 font-mono text-[0.5rem] font-semibold tracking-[0.06em] text-muted uppercase transition-colors hover:text-foreground disabled:opacity-40"
                >
                  {probeRunning
                    ? `Checking ${probeDone}/${probeTotal || pageUrls.length}…`
                    : statusSummary.checked > 0
                      ? "Re-check HTTP"
                      : "Check HTTP"}
                </button>
              </div>
            </div>
            {probeError ? (
              <p className="px-4 pt-1 text-[0.6875rem] text-red-700 dark:text-red-300">
                {probeError}
              </p>
            ) : null}
            <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-3 py-2">
              {pagesLoading ? (
                <li className="px-2 py-6 text-center text-sm text-muted">
                  Loading pages…
                </li>
              ) : pagesError ? (
                <li className="px-2 py-6 text-center text-sm text-red-700 dark:text-red-300">
                  {pagesError}
                </li>
              ) : selectedList.length === 0 ? (
                <li className="px-2 py-6 text-center text-sm text-muted">
                  Select a sitemap file to preview its page URLs.
                </li>
              ) : displayUrls.length === 0 ? (
                <li className="px-2 py-6 text-center text-sm text-muted">
                  {errorsOnly
                    ? "No non-2xx URLs in the checked set."
                    : "No page URLs in the selected sitemap(s)."}
                </li>
              ) : (
                pageSlice.map((url) => {
                  const entry = statusByUrl[url];
                  return (
                    <li
                      key={url}
                      className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-surface-raised"
                    >
                      {entry ? (
                        <span
                          className={cn(
                            "shrink-0 rounded border px-1 py-0.5 font-mono text-[0.5rem] font-semibold tracking-[0.06em] uppercase",
                            entry.ok
                              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                              : "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300",
                          )}
                          title={entry.reason ?? undefined}
                        >
                          {entry.status != null
                            ? `HTTP ${entry.status}`
                            : entry.ok
                              ? "OK"
                              : "ERR"}
                        </span>
                      ) : null}
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="min-w-0 flex-1 truncate font-mono text-[0.6875rem] text-muted hover:text-foreground hover:underline"
                        title={url}
                      >
                        {url}
                      </a>
                    </li>
                  );
                })
              )}
            </ul>
            {displayUrls.length > PAGE_SIZE ? (
              <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border px-3 py-2">
                <button
                  type="button"
                  disabled={safePage <= 0}
                  onClick={() => setPageIndex((current) => Math.max(0, current - 1))}
                  className="rounded-md px-2 py-1 font-mono text-[0.5625rem] font-semibold tracking-[0.06em] text-muted uppercase transition-colors hover:text-foreground disabled:opacity-40"
                >
                  Prev
                </button>
                <span className="font-mono text-[0.5625rem] tabular-nums text-muted">
                  {safePage * PAGE_SIZE + 1}–
                  {Math.min((safePage + 1) * PAGE_SIZE, displayUrls.length)} of{" "}
                  {displayUrls.length}
                </span>
                <button
                  type="button"
                  disabled={safePage >= pageCount - 1}
                  onClick={() =>
                    setPageIndex((current) =>
                      Math.min(pageCount - 1, current + 1),
                    )
                  }
                  className="rounded-md px-2 py-1 font-mono text-[0.5625rem] font-semibold tracking-[0.06em] text-muted uppercase transition-colors hover:text-foreground disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            ) : null}
          </div>
        </div>

        <div className="space-y-3 border-t border-border px-5 py-4">
          <div className="flex gap-2">
            <input
              type="url"
              value={customUrl}
              onChange={(event) => setCustomUrl(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  addCustom();
                }
              }}
              placeholder="https://docs.example.com/sitemap.xml"
              className="min-w-0 flex-1 rounded-md border border-border bg-background px-2.5 py-1.5 font-mono text-[0.75rem] text-foreground outline-none focus:border-accent"
            />
            <Button
              type="button"
              variant="secondary"
              onClick={addCustom}
              className="h-9 px-4 text-xs"
            >
              Add
            </Button>
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="rounded-md px-3 py-2 text-sm text-muted transition-colors hover:text-foreground"
            >
              Cancel
            </button>
            <Button
              type="button"
              onClick={() => onApply([...selected].sort())}
              className="h-9 px-4 text-xs"
            >
              Use selected
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
