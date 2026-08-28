"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  filterCatalogPages,
  formatAgentCatalogHint,
  formatPlannerCatalogPreview,
  pageCatalogPathLabel,
} from "@/lib/catalog-view";
import {
  getMetadataCatalog,
  getPageChunks,
  getSource,
  canInspectPageChunks,
  type MetadataCatalog,
  type PageChunk,
  type PageChunksResult,
  type SourceHosting,
  type SourceScope,
} from "@/lib/ledgeindex-api";
import { useAuth } from "@/lib/auth-context";
import {
  computePathPageCountsByStartUrl,
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

function PageChunkInspector({
  pageTitle,
  pageUrl,
  loading,
  error,
  result,
}: {
  pageTitle: string;
  pageUrl: string;
  loading: boolean;
  error: string | null;
  result: PageChunksResult | null;
}) {
  return (
    <div className="flex min-h-0 flex-col">
      <div className="border-b border-border px-3 py-2.5 sm:px-4">
        <p className="font-mono text-[0.5625rem] font-semibold tracking-[0.12em] text-muted uppercase">
          Indexed chunks
        </p>
        <p className="mt-0.5 truncate text-sm font-medium text-foreground">
          {pageTitle}
        </p>
        <p className="mt-0.5 truncate font-mono text-[0.625rem] text-muted">
          {pageCatalogPathLabel(pageUrl)}
        </p>
        <a
          href={pageUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-1 inline-block text-[0.6875rem] text-accent hover:underline"
        >
          Open live page
        </a>
        {result ? (
          <p className="mt-1 font-mono text-[0.5625rem] text-muted">
            {result.chunkCount} chunk{result.chunkCount === 1 ? "" : "s"}
            {result.vectorBackend ? ` · ${result.vectorBackend}` : ""}
          </p>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-4">
        {loading ? (
          <p className="text-sm text-muted">Loading chunks…</p>
        ) : null}
        {error ? (
          <p className="text-sm text-red-600 dark:text-red-300">{error}</p>
        ) : null}
        {!loading && !error && result && result.chunks.length === 0 ? (
          <p className="text-sm text-muted">
            No chunks found for this URL. The page may use a different stored
            URL than the catalog row.
          </p>
        ) : null}
        {!loading && !error && result && result.chunks.length > 0 ? (
          <ul className="space-y-3">
            {result.chunks.map((chunk) => (
              <PageChunkCard key={chunk.id || `${chunk.chunkIndex}`} chunk={chunk} />
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

function PageChunkCard({ chunk }: { chunk: PageChunk }) {
  const heading =
    chunk.headingPath.length > 0 ? chunk.headingPath.join(" › ") : null;

  return (
    <li className="rounded-lg border border-border/70 bg-background/50 p-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="inline-flex rounded-md border border-border bg-surface-raised px-1.5 py-0.5 font-mono text-[0.5625rem] font-semibold text-muted">
          #{chunk.chunkIndex + 1}
        </span>
        {heading ? (
          <span className="truncate font-mono text-[0.5625rem] text-muted">
            {heading}
          </span>
        ) : null}
      </div>
      <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap font-mono text-[0.6875rem] leading-relaxed text-foreground">
        {chunk.text}
      </pre>
    </li>
  );
}

export function SourceCatalogDialog({
  sourceId,
  sourceName,
  startUrls: startUrlsProp,
  sourceScope = "personal",
  sourceHosting,
  open,
  onOpenChange,
}: {
  sourceId: string;
  sourceName: string;
  startUrls?: readonly string[];
  sourceScope?: SourceScope;
  sourceHosting?: SourceHosting;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { isAdmin } = useAuth();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [catalog, setCatalog] = useState<MetadataCatalog | null>(null);
  const [startUrls, setStartUrls] = useState<string[]>(
    () => [...(startUrlsProp ?? [])],
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [pathScope, setPathScope] = useState("all");
  const [selectedPageUrl, setSelectedPageUrl] = useState<string | null>(null);
  const [chunksLoading, setChunksLoading] = useState(false);
  const [chunksError, setChunksError] = useState<string | null>(null);
  const [chunksResult, setChunksResult] = useState<PageChunksResult | null>(
    null,
  );
  const [resolvedHosting, setResolvedHosting] = useState<
    SourceHosting | undefined
  >(sourceHosting);

  const routing = useMemo(
    () => ({ scope: sourceScope, hosting: resolvedHosting ?? sourceHosting }),
    [resolvedHosting, sourceHosting, sourceScope],
  );

  const canInspectChunks = useMemo(
    () => canInspectPageChunks(routing, { isAdmin }),
    [isAdmin, routing],
  );

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
    setSelectedPageUrl(null);
    setChunksResult(null);
    setChunksError(null);

    void Promise.all([
      getMetadataCatalog(sourceId, routing),
      getSource(sourceId, routing),
    ])
      .then(([catalogResponse, sourceResponse]) => {
        if (cancelled) return;
        setCatalog(catalogResponse.catalog);
        setResolvedHosting(sourceResponse.source.hosting);
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
  }, [open, routing, sourceId, startUrlsProp]);

  const loadPageChunks = useCallback(
    async (pageUrl: string) => {
      if (!canInspectChunks) return;
      setSelectedPageUrl(pageUrl);
      setChunksLoading(true);
      setChunksError(null);
      setChunksResult(null);
      try {
        const result = await getPageChunks(sourceId, pageUrl, routing);
        setChunksResult(result);
      } catch (err) {
        setChunksError(
          err instanceof Error ? err.message : "Failed to load chunks",
        );
      } finally {
        setChunksLoading(false);
      }
    },
    [canInspectChunks, routing, sourceId],
  );

  const pathOptions = useMemo(
    () => pathOptionsFromStartUrls(startUrls),
    [startUrls],
  );

  const pages = catalog?.pages ?? [];

  const pathPageCounts = useMemo(() => {
    const counts = new Map<string, number>();
    counts.set("all", pages.length);
    const byUrl = computePathPageCountsByStartUrl(pages, startUrls);
    for (const option of pathOptions) {
      counts.set(option.id, byUrl.get(option.startUrl) ?? 0);
    }
    return counts;
  }, [pages, pathOptions, startUrls]);

  const startUrlPageCounts = useMemo(() => {
    return computePathPageCountsByStartUrl(pages, startUrls);
  }, [pages, startUrls]);

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

  const selectedPage = useMemo(
    () => pages.find((page) => page.url === selectedPageUrl) ?? null,
    [pages, selectedPageUrl],
  );

  return (
    <dialog
      ref={dialogRef}
      className={cn(
        "fixed inset-0 z-50 m-auto max-h-[min(85vh,56rem)] overflow-hidden rounded-xl border border-border bg-card-solid p-0 text-foreground shadow-card backdrop:bg-black/60",
        canInspectChunks
          ? "w-[min(72rem,calc(100vw-2rem))]"
          : "w-[min(52rem,calc(100vw-2rem))]",
      )}
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
                  <SourceStartUrlsHint
                    urls={startUrls}
                    pageCountsByUrl={startUrlPageCounts}
                  />
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

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="shrink-0 space-y-4 overflow-y-auto px-4 py-4 sm:px-5">
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
          </div>

          <div
            className={cn(
              "flex min-h-0 flex-1 flex-col border-t border-border",
              canInspectChunks && "lg:flex-row",
            )}
          >
            <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden px-4 pb-4 sm:px-5 lg:pb-0">
              {pathOptions.length >= 2 ? (
                <div className="shrink-0 py-3">
                  <PathScopePills
                    pathOptions={pathOptions}
                    pathScope={pathScope}
                    onPathScopeChange={setPathScope}
                    pathCounts={pathPageCounts}
                  />
                </div>
              ) : null}
              <div className="flex shrink-0 flex-col gap-2 pb-3 sm:flex-row sm:items-center sm:justify-between">
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

              <div className="min-h-0 flex-1 overflow-y-auto">
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
                  {filteredPages.map((page) => {
                    const active =
                      canInspectChunks && page.url === selectedPageUrl;
                    if (!canInspectChunks) {
                      return (
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
                            <span className="font-mono text-[0.625rem] text-muted">
                              {pageCatalogPathLabel(page.url)}
                            </span>
                            <span className="font-mono text-[0.5625rem] text-muted">
                              · {page.chunkCount} chunk
                              {page.chunkCount === 1 ? "" : "s"}
                            </span>
                          </div>
                        </li>
                      );
                    }
                    return (
                      <li key={page.url}>
                        <button
                          type="button"
                          onClick={() => void loadPageChunks(page.url)}
                          className={cn(
                            "flex w-full flex-col px-3 py-2.5 text-left transition-colors",
                            active
                              ? "bg-accent/10"
                              : "hover:bg-surface-raised/60",
                          )}
                        >
                          <span className="text-sm font-medium text-foreground">
                            {page.title}
                          </span>
                          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                            <span className="font-mono text-[0.625rem] text-muted">
                              {pageCatalogPathLabel(page.url)}
                            </span>
                            <span className="font-mono text-[0.5625rem] text-muted">
                              · {page.chunkCount} chunk
                              {page.chunkCount === 1 ? "" : "s"}
                            </span>
                            {active ? (
                              <span className="font-mono text-[0.5625rem] text-accent">
                                · inspecting
                              </span>
                            ) : null}
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </section>

            {canInspectChunks ? (
              <aside
                className={cn(
                  "flex min-h-[14rem] flex-col border-t border-border bg-surface-raised/30 lg:min-h-0 lg:w-[min(24rem,42%)] lg:shrink-0 lg:border-l lg:border-t-0",
                  !selectedPageUrl && "hidden lg:flex",
                )}
              >
                {selectedPageUrl && selectedPage ? (
                  <PageChunkInspector
                    pageTitle={selectedPage.title}
                    pageUrl={selectedPage.url}
                    loading={chunksLoading}
                    error={chunksError}
                    result={chunksResult}
                  />
                ) : (
                  <div className="flex flex-1 items-center justify-center px-4 py-8 text-center">
                    <p className="max-w-[16rem] text-sm text-muted">
                      Select a page to inspect indexed chunks
                      {routing.hosting === "cloud" || sourceScope === "global"
                        ? " (admin)."
                        : " stored on this device."}
                    </p>
                  </div>
                )}
              </aside>
            ) : null}
          </div>
        </div>
      </div>
    </dialog>
  );
}

export function SourceCatalogButton({
  sourceId,
  sourceName,
  startUrls,
  sourceScope = "personal",
  sourceHosting,
  disabled = false,
  className,
}: {
  sourceId: string;
  sourceName: string;
  startUrls?: readonly string[];
  sourceScope?: SourceScope;
  sourceHosting?: SourceHosting;
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
        sourceScope={sourceScope}
        sourceHosting={sourceHosting}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  );
}
