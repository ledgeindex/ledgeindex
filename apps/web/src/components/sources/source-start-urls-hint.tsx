"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";
import { formatUrlLabel } from "@/components/sources/source-display";
import { getMetadataCatalog, type SourceRoutingHint } from "@/lib/ledgeindex-api";
import {
  computePathPageCountsByStartUrl,
  normalizeSourcePathStartUrl,
} from "@/lib/source-paths";
import { cn } from "@/lib/utils";

export function resolveStartUrls(source: {
  startUrl?: string;
  startUrls?: string[] | null;
}): string[] {
  const fromList = (source.startUrls ?? []).filter(Boolean);
  if (fromList.length > 0) return [...new Set(fromList)];
  return source.startUrl ? [source.startUrl] : [];
}

/** Path after host for glance label, e.g. https://mastra.ai/docs → /docs */
export function formatStartUrlPathLabel(url: string): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/\/+$/, "") || "/";
    return path;
  } catch {
    const slash = url.lastIndexOf("/");
    if (slash >= 0 && slash < url.length - 1) {
      return `/${url.slice(slash + 1)}`;
    }
    return url;
  }
}

/** Stable effect key — parent often passes a fresh `urls` array each render. */
export function startUrlsEffectKey(urls: string[]): string {
  return urls
    .map((url) => url.trim())
    .filter(Boolean)
    .join("\0");
}

export function pageCountForStartUrl(
  url: string,
  counts: ReadonlyMap<string, number> | null,
): number | null {
  if (!counts) return null;
  const normalized = normalizeSourcePathStartUrl(url) || url.trim();
  if (counts.has(normalized)) return counts.get(normalized) ?? null;
  return counts.get(url) ?? null;
}

/** Compact path label with optional dropdown when multiple crawl roots exist. */
export function SourceStartUrlsHint({
  urls,
  sourceId,
  routing,
  pageCountsByUrl,
  className,
  variant = "badge",
}: {
  urls: string[];
  /** When set, page counts load from the indexed catalog when the menu opens. */
  sourceId?: string;
  routing?: SourceRoutingHint;
  /** Precomputed counts (normalized start URL → page count). */
  pageCountsByUrl?: ReadonlyMap<string, number>;
  className?: string;
  variant?: "badge" | "subtle";
}) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<{ top: number; left: number } | null>(null);
  const [loadedCounts, setLoadedCounts] = useState<Map<string, number> | null>(
    null,
  );
  const [countsLoading, setCountsLoading] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const count = urls.length;

  const effectiveCounts = pageCountsByUrl ?? loadedCounts;
  const urlsKey = useMemo(() => startUrlsEffectKey(urls), [urls]);

  useEffect(() => {
    if (!open || !sourceId || count <= 1 || pageCountsByUrl) return;

    let cancelled = false;
    setCountsLoading(loadedCounts === null);
    void getMetadataCatalog(sourceId, routing)
      .then(({ catalog }) => {
        if (cancelled) return;
        const pages = catalog?.pages ?? [];
        setLoadedCounts(computePathPageCountsByStartUrl(pages, urls));
      })
      .catch(() => {
        if (!cancelled) setLoadedCounts(null);
      })
      .finally(() => {
        if (!cancelled) setCountsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, sourceId, count, urlsKey, pageCountsByUrl, routing?.scope, routing?.hosting]);

  useEffect(() => {
    if (!open) return;

    const sync = () => {
      const button = buttonRef.current;
      if (!button) return;
      const box = button.getBoundingClientRect();
      const width = 280;
      const left = Math.min(
        Math.max(12, box.left),
        window.innerWidth - width - 12,
      );
      const top = Math.min(box.bottom + 4, window.innerHeight - 12);
      setRect({ top, left });
    };

    sync();

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        !buttonRef.current?.contains(target) &&
        !panelRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    window.addEventListener("resize", sync);
    window.addEventListener("scroll", sync, true);
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("resize", sync);
      window.removeEventListener("scroll", sync, true);
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  if (count === 0) return null;

  const firstPath = formatStartUrlPathLabel(urls[0]!);
  const label = count === 1 ? firstPath : `${firstPath} +${count - 1}`;

  const panel =
    open && rect
      ? createPortal(
          <div
            ref={panelRef}
            role="dialog"
            aria-label="Start URLs"
            style={{
              position: "fixed",
              top: rect.top,
              left: rect.left,
              width: 280,
              zIndex: 220,
            }}
            className="max-h-56 overflow-auto rounded-lg border border-border bg-card-solid py-1.5 shadow-card"
            onClick={(event) => event.stopPropagation()}
          >
            <p className="px-3 pb-1 font-mono text-[0.5rem] font-semibold tracking-[0.1em] text-muted uppercase">
              Start URLs
            </p>
            <ul className="space-y-0.5">
              {urls.map((url) => {
                const pageCount = pageCountForStartUrl(url, effectiveCounts);
                return (
                  <li key={url}>
                    <a
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      title={url}
                      className="flex items-center gap-2 px-3 py-1.5 text-xs text-foreground transition-colors hover:bg-surface-raised hover:text-accent"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <span className="min-w-0 truncate">
                        {formatUrlLabel(url)}
                      </span>
                      <span
                        className="shrink-0 font-mono text-[0.625rem] tabular-nums text-muted"
                      >
                        {countsLoading && sourceId && !pageCountsByUrl
                          ? "…"
                          : pageCount != null
                            ? `${pageCount} pages`
                            : "—"}
                      </span>
                    </a>
                  </li>
                );
              })}
            </ul>
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        title={
          count === 1 ? urls[0] : `${count} start URLs — click to view`
        }
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setOpen((current) => !current);
        }}
        className={cn(
          "inline-flex max-w-full min-w-0 items-center gap-0.5 truncate normal-case tracking-normal transition-colors",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-foreground/20",
          variant === "badge"
            ? "rounded-md border border-accent/35 bg-accent/10 px-1.5 py-0.5 font-mono text-[0.5rem] font-semibold text-accent hover:border-accent/50 hover:bg-accent/15"
            : "rounded-sm font-mono text-[0.5625rem] text-muted hover:text-foreground",
          open &&
            (variant === "badge"
              ? "border-accent/50 bg-accent/15"
              : "text-foreground"),
          className,
        )}
      >
        <span className="truncate">{label}</span>
        {count > 1 ? (
          <ChevronDown
            className={cn(
              "size-2.5 shrink-0 opacity-70 transition-transform",
              variant === "subtle" && "size-3",
              open && "rotate-180",
            )}
            aria-hidden
          />
        ) : null}
      </button>
      {panel}
    </>
  );
}

/** Inline path chips with indexed page count per crawl root (multi-path sources). */
export function SourceStartUrlPathChips({
  urls,
  sourceId,
  routing,
  pageCountsByUrl,
  refreshKey,
  pauseRefresh = false,
  className,
}: {
  urls: string[];
  sourceId?: string;
  routing?: SourceRoutingHint;
  pageCountsByUrl?: ReadonlyMap<string, number>;
  /** Bumps catalog reload after refresh / apply. */
  refreshKey?: string | number | null;
  /** Skip catalog refetch while a refresh run is in flight (avoids badge flicker). */
  pauseRefresh?: boolean;
  className?: string;
}) {
  const [loadedCounts, setLoadedCounts] = useState<Map<string, number> | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const effectiveCounts = pageCountsByUrl ?? loadedCounts;
  const urlsKey = useMemo(() => startUrlsEffectKey(urls), [urls]);
  const refreshToken =
    refreshKey == null || refreshKey === "" ? null : String(refreshKey);

  useEffect(() => {
    if (!sourceId || pageCountsByUrl || urlsKey.length === 0 || pauseRefresh) {
      return;
    }

    let cancelled = false;
    setLoading((current) => current || loadedCounts === null);
    void getMetadataCatalog(sourceId, routing)
      .then(({ catalog }) => {
        if (cancelled) return;
        const pages = catalog?.pages ?? [];
        setLoadedCounts(computePathPageCountsByStartUrl(pages, urls));
      })
      .catch(() => {
        // Keep last good counts — transient 404s during apply should not flash "—".
        if (!cancelled) {
          setLoadedCounts((prev) => prev);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [sourceId, urls, urlsKey, pageCountsByUrl, refreshToken, pauseRefresh, routing?.scope, routing?.hosting]);

  useEffect(() => {
    if (!pauseRefresh || pageCountsByUrl) return;
    setLoading(false);
  }, [pauseRefresh, pageCountsByUrl]);

  if (urls.length <= 1) return null;

  return (
    <div className={cn("mt-1 flex flex-wrap gap-1", className)}>
      {urls.map((url) => {
        const pageCount = pageCountForStartUrl(url, effectiveCounts);
        return (
          <span
            key={url}
            title={
              pageCount != null
                ? `${url} — ${pageCount} indexed pages`
                : url
            }
            className="inline-flex max-w-[12rem] items-center gap-1 truncate rounded border border-accent/35 bg-accent/10 px-1.5 py-0.5 font-mono text-[0.5rem] font-semibold text-accent"
          >
            <span className="truncate">{formatStartUrlPathLabel(url)}</span>
            <span className="shrink-0 tabular-nums opacity-80">
              {loading && sourceId && !pageCountsByUrl
                ? "…"
                : pageCount != null
                  ? pageCount
                  : "—"}
            </span>
          </span>
        );
      })}
    </div>
  );
}
