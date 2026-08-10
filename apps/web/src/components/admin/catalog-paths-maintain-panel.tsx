"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, GitCompareArrows, Loader2, Plus, Radar, Trash2, X } from "lucide-react";
import { FilterBadge } from "@/components/sources/source-category-filter";
import {
  pathsEqual,
  previewCatalogPathCrawl,
  previewCatalogPathOverlaps,
  saveCatalogPackagePaths,
  type CatalogPathDraft,
  type PathOverlapReport,
  type PathPreviewCrawlResult,
} from "@/lib/admin-docs-catalog-api";
import type {
  DocsPathKind,
  TypescriptDocsCatalogEntry,
} from "@/lib/typescript-docs-catalog";
import { cn } from "@/lib/utils";

const KIND_OPTIONS: DocsPathKind[] = [
  "guides",
  "api",
  "examples",
  "reference",
  "home",
  "other",
];

function draftFromEntry(entry: TypescriptDocsCatalogEntry): CatalogPathDraft[] {
  if (entry.paths.length > 0) {
    return entry.paths.map((path) => ({ ...path }));
  }
  if (entry.docs) {
    return [{ kind: "guides", url: entry.docs, label: "main" }];
  }
  return [];
}

function formatPathLabel(url: string): string {
  try {
    return new URL(url).pathname.replace(/\/+$/, "") || "/";
  } catch {
    return url;
  }
}

export function CatalogPathsMaintainPanel({
  entry,
  canPersist,
  onSaved,
}: {
  entry: TypescriptDocsCatalogEntry;
  canPersist: boolean;
  onSaved: (next: TypescriptDocsCatalogEntry) => void;
}) {
  const [draftPaths, setDraftPaths] = useState<CatalogPathDraft[]>(() =>
    draftFromEntry(entry),
  );
  const [addUrl, setAddUrl] = useState("");
  const [addKind, setAddKind] = useState<DocsPathKind>("guides");
  const [addLabel, setAddLabel] = useState("");
  const [busy, setBusy] = useState<"save" | "approve" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [previewByUrl, setPreviewByUrl] = useState<
    Record<string, PathPreviewCrawlResult>
  >({});
  const [previewLoadingUrl, setPreviewLoadingUrl] = useState<string | null>(
    null,
  );
  const [previewErrorByUrl, setPreviewErrorByUrl] = useState<
    Record<string, string>
  >({});
  const [modalUrl, setModalUrl] = useState<string | null>(null);
  const [modalFilter, setModalFilter] = useState("");
  const [overlapReport, setOverlapReport] = useState<PathOverlapReport | null>(
    null,
  );
  const [overlapOpen, setOverlapOpen] = useState(false);
  const [overlapBusy, setOverlapBusy] = useState(false);
  const [overlapFilter, setOverlapFilter] = useState("");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const overlapDialogRef = useRef<HTMLDialogElement>(null);

  const pathFingerprint = entry.paths.map((path) => path.url).join("\n");

  useEffect(() => {
    setDraftPaths(draftFromEntry(entry));
    setAddUrl("");
    setAddLabel("");
    setError(null);
    setNotice(null);
    setBusy(null);
    setPreviewByUrl({});
    setPreviewErrorByUrl({});
    setPreviewLoadingUrl(null);
    setModalUrl(null);
    setModalFilter("");
    setOverlapReport(null);
    setOverlapOpen(false);
    setOverlapBusy(false);
    setOverlapFilter("");
    // Reset only when the package or persisted path set changes (after save).
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional fingerprint
  }, [entry.package, entry.pathsStatus, pathFingerprint]);

  const baseline = useMemo(() => draftFromEntry(entry), [entry]);
  const dirty = !pathsEqual(draftPaths, baseline);
  const needsApprove =
    entry.pathsStatus !== "discovered" || dirty || !entry.pathsStatus;

  const modalPreview = modalUrl ? previewByUrl[modalUrl] : null;
  const modalUrls = useMemo(() => {
    const urls = modalPreview?.urls ?? [];
    const q = modalFilter.trim().toLowerCase();
    if (!q) return urls;
    return urls.filter((url) => url.toLowerCase().includes(q));
  }, [modalFilter, modalPreview]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (modalUrl && !dialog.open) dialog.showModal();
    if (!modalUrl && dialog.open) dialog.close();
  }, [modalUrl]);

  useEffect(() => {
    const dialog = overlapDialogRef.current;
    if (!dialog) return;
    if (overlapOpen && !dialog.open) dialog.showModal();
    if (!overlapOpen && dialog.open) dialog.close();
  }, [overlapOpen]);

  const filteredShared = useMemo(() => {
    const rows = overlapReport?.shared ?? [];
    const q = overlapFilter.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (row) =>
        row.url.toLowerCase().includes(q) ||
        row.paths.some((path) => path.toLowerCase().includes(q)),
    );
  }, [overlapFilter, overlapReport]);

  async function runOverlapCheck() {
    if (draftPaths.length < 2) {
      setError("Need at least 2 paths to check overlaps");
      return;
    }
    setOverlapBusy(true);
    setError(null);
    setNotice(null);
    try {
      const report = await previewCatalogPathOverlaps({
        urls: draftPaths.map((path) => path.url),
        excludePatterns: entry.excludePatterns,
        patternsAreRegex: entry.patternsAreRegex,
      });
      setOverlapReport(report);
      setOverlapFilter("");
      setOverlapOpen(true);
      // Seed per-path page counts from the shared sitemap pass.
      setPreviewByUrl((prev) => {
        const next = { ...prev };
        for (const row of report.paths) {
          next[row.startUrl] = {
            startUrl: row.startUrl,
            mode: "sitemap",
            sitemapTotal: report.sitemapTotal,
            underPathCount: row.count,
            excludedCount: 0,
            count: row.count,
            urls: prev[row.startUrl]?.urls ?? [],
            truncated: row.truncated,
          };
        }
        return next;
      });
      setNotice(
        report.nested.length === 0 && report.sharedCount === 0
          ? `No overlaps across ${report.pathCount} paths`
          : `Overlaps: ${report.nested.length} nested path pair${report.nested.length === 1 ? "" : "s"}, ${report.sharedCount} shared URL${report.sharedCount === 1 ? "" : "s"}`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Overlap check failed");
    } finally {
      setOverlapBusy(false);
    }
  }

  function removePath(url: string) {
    const nextPaths = draftPaths.filter((row) => row.url !== url);
    setDraftPaths(nextPaths);
    setNotice(null);
    setError(null);
    setPreviewByUrl((prev) => {
      if (!(url in prev)) return prev;
      const next = { ...prev };
      delete next[url];
      return next;
    });
    setPreviewErrorByUrl((prev) => {
      if (!(url in prev)) return prev;
      const next = { ...prev };
      delete next[url];
      return next;
    });
    if (modalUrl === url) setModalUrl(null);

    if (!canPersist) {
      setError("Removed locally — Save is only available in development.");
      return;
    }
    void persist(false, nextPaths, "Removed path and wrote catalog JSON");
  }

  function addPath() {
    const url = addUrl.trim();
    if (!url) {
      setError("Paste a full URL to add");
      return;
    }
    try {
      // validate
      new URL(url);
    } catch {
      setError("URL must be absolute (https://…)");
      return;
    }
    const key = url.replace(/\/+$/, "").toLowerCase();
    if (
      draftPaths.some(
        (row) => row.url.replace(/\/+$/, "").toLowerCase() === key,
      )
    ) {
      setError("That URL is already in the path set");
      return;
    }
    const nextPaths: CatalogPathDraft[] = [
      ...draftPaths,
      {
        kind: addKind,
        url,
        ...(addLabel.trim() ? { label: addLabel.trim() } : {}),
        confidence: 1,
      },
    ];
    setDraftPaths(nextPaths);
    setAddUrl("");
    setAddLabel("");
    setError(null);
    setNotice(null);
  }

  async function persist(
    approve: boolean,
    pathsOverride?: CatalogPathDraft[],
    successNotice?: string,
  ) {
    if (!canPersist) {
      setError("Path edits only save in local development.");
      return;
    }
    const pathsToSave = pathsOverride ?? draftPaths;
    setBusy(approve ? "approve" : "save");
    setError(null);
    setNotice(null);
    try {
      const saved = await saveCatalogPackagePaths({
        packageName: entry.package,
        paths: pathsToSave,
        approve,
        pathsReason: approve
          ? "Approved in Source updater (manual path review)"
          : entry.pathsReason || undefined,
      });
      onSaved(saved);
      setDraftPaths(draftFromEntry(saved));
      setNotice(
        successNotice ??
          (approve
            ? "Approved — wrote top-typescript-docs.json + synced catalog"
            : "Saved — wrote top-typescript-docs.json + synced catalog"),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(null);
    }
  }

  async function runPreview(url: string) {
    setPreviewLoadingUrl(url);
    setPreviewErrorByUrl((prev) => {
      const next = { ...prev };
      delete next[url];
      return next;
    });
    setError(null);
    try {
      const result = await previewCatalogPathCrawl({
        url,
        excludePatterns: entry.excludePatterns,
        patternsAreRegex: entry.patternsAreRegex,
      });
      setPreviewByUrl((prev) => ({ ...prev, [url]: result }));
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Preview crawl failed";
      setPreviewErrorByUrl((prev) => ({ ...prev, [url]: message }));
    } finally {
      setPreviewLoadingUrl((current) => (current === url ? null : current));
    }
  }

  return (
    <section className="space-y-2 rounded-lg border border-border bg-surface-alt/60 p-2.5">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-mono text-[0.5rem] font-semibold tracking-[0.12em] text-muted uppercase">
            Maintain paths
          </p>
          <p className="mt-0.5 text-[0.625rem] leading-4 text-muted">
            Add / remove section roots. Trash removes and writes the catalog
            JSON immediately in development. Hover a path to preview sitemap
            page counts.
          </p>
        </div>
        {entry.pathsStatus ? (
          <span
            className={cn(
              "shrink-0 rounded-md border px-1.5 py-0.5 font-mono text-[0.5rem] font-semibold uppercase",
              entry.pathsStatus === "discovered"
                ? "border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                : entry.pathsStatus === "uncertain"
                  ? "border-amber-500/35 bg-amber-500/10 text-amber-800 dark:text-amber-300"
                  : entry.pathsStatus === "failed"
                    ? "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300"
                    : "border-border bg-background text-muted",
            )}
          >
            {entry.pathsStatus}
          </span>
        ) : (
          <span className="shrink-0 rounded-md border border-border bg-background px-1.5 py-0.5 font-mono text-[0.5rem] font-semibold text-muted uppercase">
            missing
          </span>
        )}
      </div>

      {entry.pathsReason ? (
        <p className="rounded-md border border-border/70 bg-background/70 px-2 py-1.5 text-[0.625rem] leading-4 text-muted-strong">
          {entry.pathsReason}
        </p>
      ) : null}

      {draftPaths.length === 0 ? (
        <p className="text-xs text-muted">No paths yet — add a URL below.</p>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-background">
          {draftPaths.map((path) => {
            const preview = previewByUrl[path.url];
            const previewError = previewErrorByUrl[path.url];
            const loading = previewLoadingUrl === path.url;
            const overlapPath = overlapReport?.paths.find(
              (row) => row.startUrl === path.url,
            );
            const nestedUnder = overlapPath?.nestedUnder ?? [];
            return (
              <li
                key={path.url}
                className="group flex items-start gap-2 px-2.5 py-1.5"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-[0.5625rem] font-semibold tracking-[0.06em] text-muted uppercase">
                    {path.kind}
                    {path.label ? ` · ${path.label}` : ""}
                  </p>
                  <a
                    href={path.url}
                    target="_blank"
                    rel="noreferrer"
                    className="block break-all font-mono text-[0.625rem] leading-4 text-foreground hover:text-accent hover:underline"
                  >
                    {formatPathLabel(path.url)}
                  </a>
                  {nestedUnder.length > 0 ? (
                    <p className="mt-0.5 font-mono text-[0.5rem] text-amber-700 dark:text-amber-300">
                      nested under{" "}
                      {nestedUnder.map((url) => formatPathLabel(url)).join(", ")}
                    </p>
                  ) : null}
                  {previewError ? (
                    <p className="mt-0.5 text-[0.5625rem] text-red-600 dark:text-red-300">
                      {previewError}
                    </p>
                  ) : null}
                </div>
                <div className="mt-0.5 flex shrink-0 items-center gap-1">
                  {preview ? (
                    <button
                      type="button"
                      className="rounded-md border border-emerald-500/35 bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[0.5625rem] font-semibold text-emerald-700 tabular-nums hover:border-emerald-500/50 dark:text-emerald-300"
                      title="Open discovered URLs"
                      onClick={() => {
                        setModalFilter("");
                        setModalUrl(path.url);
                      }}
                    >
                      {preview.count}
                      {preview.truncated ? "+" : ""} pg
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className={cn(
                      "rounded-md border border-border p-1 text-muted transition-opacity hover:border-accent/40 hover:bg-accent/10 hover:text-accent",
                      loading
                        ? "opacity-100"
                        : preview
                          ? "opacity-60 group-hover:opacity-100"
                          : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
                    )}
                    title="Preview crawl (sitemap under this path)"
                    aria-label={`Preview crawl for ${path.url}`}
                    disabled={loading}
                    onClick={() => void runPreview(path.url)}
                  >
                    {loading ? (
                      <Loader2 className="size-3 animate-spin" aria-hidden />
                    ) : (
                      <Radar className="size-3" aria-hidden />
                    )}
                  </button>
                  <button
                    type="button"
                    className="rounded-md border border-border p-1 text-muted hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-700 disabled:opacity-50 dark:hover:text-red-300"
                    title="Remove path and save catalog JSON"
                    aria-label={`Remove ${path.url}`}
                    disabled={busy != null}
                    onClick={() => removePath(path.url)}
                  >
                    <Trash2 className="size-3" aria-hidden />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="space-y-1.5 border-t border-border/70 pt-2">
        <p className="font-mono text-[0.5rem] font-semibold tracking-[0.12em] text-muted uppercase">
          Add path URL
        </p>
        <div className="flex flex-wrap gap-1.5">
          <select
            value={addKind}
            onChange={(event) =>
              setAddKind(event.target.value as DocsPathKind)
            }
            className="h-8 rounded-lg border border-border bg-card-solid px-2 font-mono text-[0.625rem] text-foreground"
            aria-label="Path kind"
          >
            {KIND_OPTIONS.map((kind) => (
              <option key={kind} value={kind}>
                {kind}
              </option>
            ))}
          </select>
          <input
            type="text"
            value={addLabel}
            onChange={(event) => setAddLabel(event.target.value)}
            placeholder="Label (optional)"
            className="h-8 min-w-[7rem] flex-1 rounded-lg border border-border bg-card-solid px-2.5 text-xs text-foreground placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          />
        </div>
        <div className="flex gap-1.5">
          <input
            type="url"
            value={addUrl}
            onChange={(event) => setAddUrl(event.target.value)}
            placeholder="https://…"
            className="h-8 min-w-0 flex-1 rounded-lg border border-border bg-card-solid px-2.5 font-mono text-[0.6875rem] text-foreground placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                addPath();
              }
            }}
          />
          <FilterBadge active={false} onClick={addPath}>
            <Plus className="size-3" aria-hidden />
            Add
          </FilterBadge>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5 pt-1">
        <FilterBadge
          active={false}
          disabled={
            draftPaths.length < 2 || overlapBusy || busy != null
          }
          onClick={() => void runOverlapCheck()}
          title="Sitemap-preview all paths and detect nested / shared URLs"
        >
          {overlapBusy ? (
            <Loader2 className="size-3 animate-spin" aria-hidden />
          ) : (
            <GitCompareArrows className="size-3" aria-hidden />
          )}
          {overlapBusy ? "Checking…" : "Check overlaps"}
        </FilterBadge>
        {overlapReport ? (
          <FilterBadge
            active={false}
            onClick={() => setOverlapOpen(true)}
            title="Re-open last overlap report"
          >
            Report
            <span className="opacity-60">
              ({overlapReport.sharedCount} shared)
            </span>
          </FilterBadge>
        ) : null}
        <FilterBadge
          active={false}
          disabled={!canPersist || busy != null || !dirty}
          onClick={() => void persist(false)}
        >
          {busy === "save" ? "Saving…" : dirty ? "Save paths" : "Saved"}
        </FilterBadge>
        <FilterBadge
          active
          disabled={!canPersist || busy != null || draftPaths.length === 0}
          onClick={() => void persist(true)}
          title={
            needsApprove
              ? "Write paths and mark pathsStatus=discovered"
              : "Re-approve current path set"
          }
        >
          <Check className="size-3" aria-hidden />
          {busy === "approve" ? "Approving…" : "Approve paths"}
        </FilterBadge>
      </div>

      {!canPersist ? (
        <p className="text-[0.625rem] text-amber-700 dark:text-amber-300">
          Persistence is available when the web app runs in development
          (writes `top-typescript-docs.json`).
        </p>
      ) : null}
      {error ? (
        <p className="text-[0.625rem] text-red-600 dark:text-red-300">{error}</p>
      ) : null}
      {notice ? (
        <p className="text-[0.625rem] text-emerald-700 dark:text-emerald-300">
          {notice}
        </p>
      ) : null}

      <dialog
        ref={dialogRef}
        className="fixed inset-0 z-50 m-auto w-[min(40rem,calc(100vw-2rem))] max-h-[min(80vh,40rem)] overflow-hidden rounded-xl border border-border bg-card-solid p-0 text-foreground shadow-card backdrop:bg-black/60"
        onClose={() => setModalUrl(null)}
      >
        <div className="flex max-h-[min(80vh,40rem)] flex-col">
          <header className="border-b border-border px-3 py-2.5 sm:px-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-mono text-[0.5rem] font-semibold tracking-[0.12em] text-muted uppercase">
                  Path preview
                </p>
                <h2 className="truncate font-mono text-sm font-semibold">
                  {modalUrl ? formatPathLabel(modalUrl) : "URLs"}
                </h2>
                {modalPreview ? (
                  <p className="mt-0.5 text-[0.625rem] text-muted">
                    {modalPreview.count} page
                    {modalPreview.count === 1 ? "" : "s"} under path
                    {modalPreview.excludedCount > 0
                      ? ` · ${modalPreview.excludedCount} excluded`
                      : ""}
                    {modalPreview.truncated ? " · truncated" : ""}
                    {" · sitemap "}
                    {modalPreview.sitemapTotal}
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => setModalUrl(null)}
                className="shrink-0 rounded-md border border-border p-1 text-muted hover:text-foreground"
                aria-label="Close"
              >
                <X className="size-3.5" aria-hidden />
              </button>
            </div>
            <input
              type="search"
              value={modalFilter}
              onChange={(event) => setModalFilter(event.target.value)}
              placeholder="Filter URLs…"
              className="mt-2 h-7 w-full rounded-md border border-border bg-background px-2.5 text-xs text-foreground placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            />
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {modalUrls.length === 0 ? (
              <p className="px-4 py-6 text-sm text-muted">No URLs match.</p>
            ) : (
              <ul className="divide-y divide-border">
                {modalUrls.map((url) => (
                  <li key={url} className="px-3 py-1.5 sm:px-4">
                    <a
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      className="block break-all font-mono text-[0.625rem] leading-4 text-foreground hover:text-accent hover:underline"
                    >
                      {url}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </dialog>

      <dialog
        ref={overlapDialogRef}
        className="fixed inset-0 z-50 m-auto w-[min(44rem,calc(100vw-2rem))] max-h-[min(85vh,44rem)] overflow-hidden rounded-xl border border-border bg-card-solid p-0 text-foreground shadow-card backdrop:bg-black/60"
        onClose={() => setOverlapOpen(false)}
      >
        <div className="flex max-h-[min(85vh,44rem)] flex-col">
          <header className="border-b border-border px-3 py-2.5 sm:px-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-mono text-[0.5rem] font-semibold tracking-[0.12em] text-muted uppercase">
                  Path overlaps
                </p>
                <h2 className="truncate text-sm font-semibold">
                  {entry.package}
                </h2>
                {overlapReport ? (
                  <p className="mt-0.5 text-[0.625rem] text-muted">
                    {overlapReport.pathCount} paths · sitemap{" "}
                    {overlapReport.sitemapTotal} ·{" "}
                    {overlapReport.nested.length} nested ·{" "}
                    {overlapReport.sharedCount} shared URLs
                    {overlapReport.sharedTruncated ? " (truncated)" : ""}
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => setOverlapOpen(false)}
                className="shrink-0 rounded-md border border-border p-1 text-muted hover:text-foreground"
                aria-label="Close"
              >
                <X className="size-3.5" aria-hidden />
              </button>
            </div>
          </header>

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3 sm:px-4">
            {overlapReport?.nested.length ? (
              <section className="space-y-1.5">
                <p className="font-mono text-[0.5rem] font-semibold tracking-[0.12em] text-amber-700 uppercase dark:text-amber-300">
                  Nested paths
                </p>
                <p className="text-[0.625rem] text-muted">
                  Child paths are already covered by a parent start URL — usually
                  remove the child (or the parent) to avoid double work.
                </p>
                <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
                  {overlapReport.nested.map((row) => (
                    <li
                      key={`${row.parent}→${row.child}`}
                      className="px-2.5 py-1.5 font-mono text-[0.625rem]"
                    >
                      <span className="text-foreground">
                        {formatPathLabel(row.child)}
                      </span>
                      <span className="text-muted"> ⊂ </span>
                      <span className="text-foreground">
                        {formatPathLabel(row.parent)}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {overlapReport ? (
              <section className="space-y-1.5">
                <p className="font-mono text-[0.5rem] font-semibold tracking-[0.12em] text-muted uppercase">
                  Per-path counts
                </p>
                <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
                  {overlapReport.paths.map((row) => (
                    <li
                      key={row.startUrl}
                      className="flex items-center justify-between gap-2 px-2.5 py-1.5"
                    >
                      <span className="min-w-0 truncate font-mono text-[0.625rem]">
                        {formatPathLabel(row.startUrl)}
                      </span>
                      <span className="shrink-0 font-mono text-[0.5625rem] text-muted tabular-nums">
                        {row.count} pg · {row.exclusiveCount} exclusive
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            <section className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <p className="font-mono text-[0.5rem] font-semibold tracking-[0.12em] text-muted uppercase">
                  Shared URLs
                </p>
                <input
                  type="search"
                  value={overlapFilter}
                  onChange={(event) => setOverlapFilter(event.target.value)}
                  placeholder="Filter…"
                  className="h-6 w-40 rounded-md border border-border bg-background px-2 text-[0.625rem] text-foreground placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                />
              </div>
              {filteredShared.length === 0 ? (
                <p className="rounded-lg border border-border px-3 py-4 text-sm text-muted">
                  {overlapReport?.sharedCount
                    ? "No shared URLs match this filter."
                    : "No shared URLs across these paths."}
                </p>
              ) : (
                <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
                  {filteredShared.map((row) => (
                    <li key={row.url} className="space-y-0.5 px-2.5 py-1.5">
                      <a
                        href={row.url}
                        target="_blank"
                        rel="noreferrer"
                        className="block break-all font-mono text-[0.625rem] leading-4 text-foreground hover:text-accent hover:underline"
                      >
                        {row.url}
                      </a>
                      <p className="font-mono text-[0.5rem] text-muted">
                        in {row.paths.map((url) => formatPathLabel(url)).join(" · ")}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </div>
      </dialog>
    </section>
  );
}
