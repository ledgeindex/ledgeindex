"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  filterCatalogPages,
  formatAgentCatalogHint,
  formatPlannerCatalogPreview,
  pageCatalogPathLabel,
} from "@/lib/catalog-view";
import { getMetadataCatalog, type MetadataCatalog } from "@/lib/ledgeindex-api";
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
  open,
  onOpenChange,
}: {
  sourceId: string;
  sourceName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [catalog, setCatalog] = useState<MetadataCatalog | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

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

    void getMetadataCatalog(sourceId)
      .then((response) => {
        if (!cancelled) setCatalog(response.catalog);
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
  }, [open, sourceId]);

  const pages = catalog?.pages ?? [];
  const filteredPages = useMemo(
    () => filterCatalogPages(pages, filter),
    [pages, filter],
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
                  {pages.length} page{pages.length === 1 ? "" : "s"} · updated{" "}
                  {formatUpdatedAt(catalog.updatedAt)}
                </p>
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
                  ? "No pages match your filter."
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
  disabled = false,
  className,
}: {
  sourceId: string;
  sourceName: string;
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
        open={open}
        onOpenChange={setOpen}
      />
    </>
  );
}
