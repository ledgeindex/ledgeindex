"use client";

import { cn } from "@/lib/utils";
import type { SourceSummary, SourceVersionSummary } from "@/lib/ledgeindex-api";

export function resolveSourceVersion(
  source: SourceSummary,
  versionId?: string | null,
): SourceSummary {
  if (!versionId || versionId === source.id) return source;
  const match = source.versions.find((entry) => entry.id === versionId);
  if (!match) return source;
  return {
    ...source,
    id: match.id,
    versionNumber: match.versionNumber,
    versionLabel: match.versionLabel,
    indexedAt: match.indexedAt,
    pageCount: match.pageCount,
    chunkCount: match.chunkCount,
  };
}

export function latestVersionEntry(
  versions: SourceVersionSummary[],
): SourceVersionSummary | null {
  if (versions.length === 0) return null;
  return [...versions].sort((a, b) => b.versionNumber - a.versionNumber)[0] ?? null;
}

export function SourceVersionSelect({
  versions,
  value,
  onChange,
  className,
}: {
  versions: SourceVersionSummary[];
  value: string;
  onChange: (sourceId: string) => void;
  className?: string;
}) {
  if (versions.length <= 1) {
    const only = versions[0];
    if (!only) return null;
    return (
      <span
        className={cn(
          "inline-flex items-center rounded-md border border-border bg-surface-raised px-2 py-0.5 font-mono text-[0.625rem] text-muted",
          className,
        )}
      >
        {only.versionLabel}
      </span>
    );
  }

  return (
    <label className={cn("inline-flex min-w-0 items-center gap-1.5", className)}>
      <span className="sr-only">Documentation version</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="max-w-full truncate rounded-md border border-border bg-surface-raised px-2 py-0.5 font-mono text-[0.625rem] text-foreground"
      >
        {versions.map((version) => (
          <option key={version.id} value={version.id}>
            {version.versionLabel} · {version.chunkCount} chunks
          </option>
        ))}
      </select>
    </label>
  );
}
