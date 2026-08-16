"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";
import { formatUrlLabel } from "@/components/sources/source-display";
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

/** Compact path label with optional dropdown when multiple crawl roots exist. */
export function SourceStartUrlsHint({
  urls,
  className,
  variant = "badge",
}: {
  urls: string[];
  className?: string;
  variant?: "badge" | "subtle";
}) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const count = urls.length;

  useEffect(() => {
    if (!open) return;

    const sync = () => {
      const button = buttonRef.current;
      if (!button) return;
      const box = button.getBoundingClientRect();
      const width = 260;
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
              width: 260,
              zIndex: 220,
            }}
            className="max-h-56 overflow-auto rounded-lg border border-border bg-card-solid py-1.5 shadow-card"
            onClick={(event) => event.stopPropagation()}
          >
            <p className="px-3 pb-1 font-mono text-[0.5rem] font-semibold tracking-[0.1em] text-muted uppercase">
              Start URLs
            </p>
            <ul className="space-y-0.5">
              {urls.map((url) => (
                <li key={url}>
                  <a
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    title={url}
                    className="block truncate px-3 py-1.5 text-xs text-foreground transition-colors hover:bg-surface-raised hover:text-accent"
                    onClick={(event) => event.stopPropagation()}
                  >
                    {formatUrlLabel(url)}
                  </a>
                </li>
              ))}
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