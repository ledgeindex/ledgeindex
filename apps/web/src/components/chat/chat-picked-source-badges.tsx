"use client";

import { useState } from "react";
import { CachedRemoteImage } from "@/components/sources/cached-remote-image";
import type { RetrievalPickedSource } from "@/lib/retrieval-meta";
import { cn } from "@/lib/utils";

export function sourceOriginLabel(
  source: Pick<RetrievalPickedSource, "remote" | "scope">,
): "Local" | "Remote" | null {
  if (typeof source.remote === "boolean") {
    return source.remote ? "Remote" : "Local";
  }
  if (source.scope === "personal") return "Local";
  return null;
}

export function SourceOriginBadge({
  source,
}: {
  source: Pick<RetrievalPickedSource, "remote" | "scope">;
}) {
  const label = sourceOriginLabel(source);
  if (!label) return null;
  return (
    <span
      className={cn(
        "shrink-0 rounded px-1 py-px text-[0.5625rem] font-semibold uppercase tracking-wide",
        label === "Remote"
          ? "bg-accent/15 text-accent"
          : "bg-surface-raised text-muted",
      )}
    >
      {label}
    </span>
  );
}

export function SourceBadgeFavicon({
  source,
}: {
  source: Pick<RetrievalPickedSource, "id" | "name" | "faviconUrl">;
}) {
  const [failed, setFailed] = useState(false);
  const showFavicon = Boolean(source.faviconUrl) && !failed;
  const initials = source.name.slice(0, 2).toUpperCase();

  if (showFavicon) {
    return (
      <CachedRemoteImage
        sourceId={source.id}
        url={source.faviconUrl!}
        className="size-3.5 shrink-0 rounded-sm object-contain"
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <span
      className="inline-flex size-3.5 shrink-0 items-center justify-center rounded-sm bg-surface-raised font-mono text-[0.4375rem] font-semibold text-muted"
      aria-hidden
    >
      {initials}
    </span>
  );
}

export function ChatPickedSourceBadges({
  sources,
  className,
}: {
  sources: readonly RetrievalPickedSource[];
  className?: string;
}) {
  if (sources.length === 0) return null;

  return (
    <div
      className={cn(
        "flex min-w-0 flex-wrap items-center gap-1.5",
        className,
      )}
      aria-label="Sources used for the last answer"
    >
      {sources.map((source) => {
        const href = source.startUrl?.trim() || undefined;
        const origin = sourceOriginLabel(source);
        const content = (
          <>
            <SourceBadgeFavicon source={source} />
            <span className="max-w-[9rem] truncate">{source.name}</span>
            <SourceOriginBadge source={source} />
          </>
        );

        const chipClass = cn(
          "inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-card-solid px-2 py-0.5",
          "text-[11px] font-medium text-foreground shadow-card",
        );

        if (href) {
          return (
            <a
              key={source.id}
              href={href}
              target="_blank"
              rel="noreferrer"
              title={origin ? `${source.slug} · ${origin}` : source.slug}
              className={cn(
                chipClass,
                "hover:border-foreground/20 hover:bg-surface-raised",
              )}
            >
              {content}
            </a>
          );
        }

        return (
          <span
            key={source.id}
            title={origin ? `${source.slug} · ${origin}` : source.slug}
            className={chipClass}
          >
            {content}
          </span>
        );
      })}
    </div>
  );
}
