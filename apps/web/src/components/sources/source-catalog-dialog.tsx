"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  filterCatalogPages,
  formatAgentCatalogHint,
  formatPlannerCatalogPreview,
  pageCatalogPathLabel,
} from "@/lib/catalog-view";
import { getMetadataCatalog, getSource, type MetadataCatalog } from "@/lib/ledgeindex-api";
import {
  pageBelongsToSourcePath,
  pathOptionsFromStartUrls,
  pathRootSegment,
} from "@/lib/source-paths";
import { PathScopePills } from "@/components/chat/path-scope-pill";
import {
  resolveStartUrls,
  SourceStartUrlsHint,
} from "@/components/sources/source-start-urls-hint";
import { cn } from "@/lib/utils";

function formatUpdatedAt(value: string | undefined): string {
  if (!value) return "Unknown";
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

export function SourceCatalogDialog({
  sourceId,
  sourceName,
  startUrls: startUrlsProp,
  open,
  onOpenChange,
}: {
  sourceId: string;
  sourceName: string;
  startUrls?: readonly string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [catalog, setCatalog] = useState<MetadataCatalog | null>(null);
  const [startUrls, setStartUrls] = useState<string[]>(
    () => [...(startUrlsProp ?? [])],
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [pathScope, setPathScope] = useState("all");

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    setLoading(true);
    setError(null);
    setPathScope("all");

    void Promise.all([getMetadataCatalog(sourceId), getSource(sourceId)])
      .then(([catalogResponse, sourceResponse]) => {
        if (cancelled) return;
        setCatalog(catalogResponse.catalog);
        const roots =
          startUrlsProp && startUrlsProp.length > 0
            ? [...startUrlsProp]
            : resolveStartUrls({
                startUrl: sourceResponse.source.config.startUrls?.[0],
                startUrls: sourceResponse.source.config.startUrls,
              });
        setStartUrls(roots);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load catalog");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, sourceId, startUrlsProp]);

  const pathOptions = useMemo(
    () => pathOptionsFromStartUrls(startUrls),
    [startUrls],
  );

  const pages = catalog?.pages ?? [];

  const pathPageCounts = useMemo(() => {
    const counts = new Map<string, number>();
    counts.set("all", pages.length);
    for (const option of pathOptions) {
      counts.set(
        option.id,
        pages.filter((page) =>
          pageBelongsToSourcePath(page.url, option.startUrl, {
            crawlRoot: page.crawlRoot,
            category: page.category,
          }),
        ).length,
      );
    }
    return counts;
  }, [pages, pathOptions]);

  const pagesForPath = useMemo(() => {
    if (pathScope === "all") return pages;
    const selected = pathOptions.find((option) => option.id === pathScope);
    if (!selected) return pages;
    return pages.filter((page) =>
      pageBelongsToSourcePath(page.url, selected.startUrl, {
        crawlRoot: page.crawlRoot,
        category: page.category,
      }),
    );
  }, [pages, pathOptions, pathScope]);

  const indexedPathSegments = useMemo(() => {
    const segments = new Map<string, number>();
    for (const page of pages) {
      const seg =
        page.category?.toLowerCase() ||
        (() => {
          try {
            return (
              new URL(page.url).pathname.split("/").filter(Boolean)[0]?.toLowerCase() ??
              ""
            );
          } catch {
            return "";
          }
        })();
      if (!seg) continue;
      segments.set(seg, (segments.get(seg) ?? 0) + 1);
    }
    return [...segments.entries()].sort((a, b) => b[1] - a[1]);
  }, [pages]);

  const filteredPages = useMemo(
    () => filterCatalogPages(pagesForPath, filter),
    [pagesForPath, filter],
  );

  return (
    <dialog
      ref={dialogRef}
      className="fixed inset-0 z-50 m-auto w-[min(52rem,calc(100vw-2rem))] max-h-[min(85vh,56rem)] overflow-hidden rounded-xl border border-border bg-card-solid p-0 text-foreground shadow-card backdrop:bg-black/60"
      onClose={() => onOpenChange(false)}
    >
      <div className="flex max-h-[min(85vh,56rem)] flex-col">
        <header className="border-b border-border px-4 py-3 sm:px-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-mono text-[0.5625rem] font-semibold tracking-[0.12em] text-muted uppercase">
                Indexed pages
              </p>
              <h2 className="truncate text-base font-semibold">{sourceName}</h2>
              {catalog ? (
                <p className="mt-1 text-xs text-muted">
                  {pagesForPath.length} page{pagesForPath.length === 1 ? "" : "s"}
                  {pathScope !== "all" ? " in path" : ""} · updated{" "}
                  {formatUpdatedAt(catalog.updatedAt)}
                </p>
              ) : null}
              {startUrls.length > 0 ? (
                <div
                  className="mt-2 flex flex-wrap items-center gap-1.5"
                  onClick={(event) => event.stopPropagation()}
                >
                  <span className="font-mono text-[0.5rem] font-semibold tracking-[0.1em] text-muted uppercase">
                    Roots
                  </span>
                  <SourceStartUrlsHint urls={startUrls} />
                </div>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="shrink-0 rounded-md border border-border px-2 py-1 text-xs text-muted hover:text-foreground"
            >
              Close
            </button>
          </div>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-5">
          <details className="rounded-lg border border-border/70 bg-surface-raised/50 p-3 text-sm">
            <summary className="cursor-pointer font-mono text-[0.5625rem] font-semibold tracking-[0.1em] text-muted uppercase">
              What the agent / planner sees (preview)
            </summary>
            <div className="mt-3 space-y-3">
              <div>
                <p className="text-[0.6875rem] font-medium text-foreground">
                  Agent hint
                </p>
                <p className="mt-1 text-xs text-muted">
                  {formatAgentCatalogHint(catalog)}
                </p>
              </div>
              <div>
                <p className="text-[0.6875rem] font-medium text-foreground">
                  Query planner sample
                </p>
                <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap font-mono text-[0.6875rem] leading-relaxed text-muted">
                  {formatPlannerCatalogPreview(catalog)}
                </pre>
              </div>
            </div>
          </details>

          <section className="space-y-3">
            {pathOptions.length >= 2 ? (
              <PathScopePills
                pathOptions={pathOptions}
                pathScope={pathScope}
                onPathScopeChange={setPathScope}
                pathCounts={pathPageCounts}
              />
            ) : null}
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="font-mono text-[0.5625rem] font-semibold tracking-[0.1em] text-muted uppercase">
                All indexed pages
              </p>
              <input
                type="search"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                placeholder="Filter by title or path…"
                className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-foreground outline-none ring-0 placeholder:text-muted sm:max-w-xs"
              />
            </div>

            {loading ? (
              <p className="text-sm text-muted">Loading pages…</p>
            ) : null}
            {error ? (
              <p className="text-sm text-red-600 dark:text-red-300">{error}</p>
            ) : null}
            {!loading && !error && filteredPages.length === 0 ? (
              <p className="text-sm text-muted">
                {catalog
                  ? pathScope !== "all" && pages.length > 0
                    ? (() => {
                        const selected = pathOptions.find(
                          (option) => option.id === pathScope,
                        );
                        const seg = selected
                          ? pathRootSegment(selected.startUrl)
                          : "";
                        const indexedSummary = indexedPathSegments
                          .map(([name, count]) => `${name} (${count})`)
                          .join(", ");
                        return `No indexed pages under this crawl root${
                          seg ? ` (/${seg})` : ""
                        }. ${
                          indexedSummary
                            ? `Indexed URL paths: ${indexedSummary}.`
                            : ""
                        } Run a paths-only update in Source updater if this path should have pages.`;
                      })()
                    : filter.trim()
                      ? "No pages match your filter."
                      : "No catalog for this set yet — index pages first."
                  : "No catalog for this set yet — index pages first."}
              </p>
            ) : null}

            <ul className="divide-y divide-border/60 rounded-lg border border-border/70 bg-background/40">
              {filteredPages.map((page) => (
                <li key={page.url} className="px-3 py-2.5">
                  <a
                    href={page.url}
                    target="_blank"
                    rel="noreferrer"
                    className="block text-sm font-medium text-foreground hover:text-accent hover:underline"
                  >
                    {page.title}
                  </a>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <p className="font-mono text-[0.625rem] text-muted">
                      {pageCatalogPathLabel(page.url)}
                    </p>
                    <span className="font-mono text-[0.5625rem] text-muted">
                      · {page.chunkCount} chunk
                      {page.chunkCount === 1 ? "" : "s"}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </dialog>
  );
}

export function SourceCatalogButton({
  sourceId,
  sourceName,
  startUrls,
  disabled = false,
  className,
}: {
  sourceId: string;
  sourceName: string;
  startUrls?: readonly string[];
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className={cn(
          "inline-flex items-center justify-center rounded-lg border border-border bg-surface-raised px-3 py-2 text-xs font-medium text-muted transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
      >
        Catalog
      </button>
      <SourceCatalogDialog
        sourceId={sourceId}
        sourceName={sourceName}
        startUrls={startUrls}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  );
}
