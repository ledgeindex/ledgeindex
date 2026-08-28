"use client";

import { useCallback, useEffect, useRef } from "react";
import {
  formatIndexedAt,
  formatIndexedAtRelative,
} from "@/components/sources/source-display";
import { useOptionalSourceChatToolbar } from "@/contexts/source-chat-toolbar-context";
import { useOptionalSourceRefreshJobs } from "@/contexts/source-refresh-jobs-context";
import { useAuth } from "@/lib/auth-context";
import { getSource } from "@/lib/ledgeindex-api";
import { cn } from "@/lib/utils";

function canUpdateSource(input: {
  sourceId?: string;
  startUrl?: string;
  scope?: "personal" | "global";
  isAdmin: boolean;
}): boolean {
  if (!input.sourceId || !input.startUrl) return false;
  if (input.scope === "global") return input.isAdmin;
  return true;
}

export function SourceChatUpdateControls({
  variant,
  className,
}: {
  variant: "header-date" | "header-action" | "panel";
  className?: string;
}) {
  const toolbar = useOptionalSourceChatToolbar();
  const jobs = useOptionalSourceRefreshJobs();
  const { isAdmin } = useAuth();
  const source = toolbar?.activeSource;
  const sourceId = source?.sourceId;
  const sourceName = source?.sourceName ?? "Source";
  const startUrl = source?.startUrl ?? source?.startUrls?.[0];
  const indexedAt = source?.indexedAt ?? null;
  const scope = source?.scope === "global" ? "global" : "personal";
  const canUpdate = canUpdateSource({
    sourceId,
    startUrl,
    scope,
    isAdmin,
  });
  const absolute = formatIndexedAt(indexedAt);
  const relative = formatIndexedAtRelative(indexedAt);
  const appliedRunIdRef = useRef<string | null>(null);

  const startUpdate = useCallback(() => {
    if (!sourceId || !startUrl || !jobs) return;
    void jobs.startJob({
      sourceId,
      sourceName,
      sourceStartUrl: startUrl,
      sourceScope: scope,
      hosting: source?.hosting,
    });
  }, [jobs, scope, source?.hosting, sourceId, sourceName, startUrl]);

  const handleApplied = useCallback(async () => {
    if (!sourceId || !toolbar || !source) return;
    try {
      const { source: next } = await getSource(sourceId, {
        scope,
        hosting: source.hosting,
      });
      toolbar.setActiveSource({
        ...source,
        sourceName: next.name || source.sourceName,
        startUrls: next.config.startUrls ?? source.startUrls,
        startUrl: next.config.startUrls?.[0] ?? startUrl,
        indexedAt: next.indexedAt ?? null,
        hosting: next.hosting ?? source.hosting,
      });
    } catch {
      // Date stays as-is.
    }
  }, [scope, source, sourceId, startUrl, toolbar]);

  const doneRunId = jobs?.jobs.find((job) => job.sourceId === sourceId)
    ?.snapshot?.status === "done"
    ? jobs.jobs.find((job) => job.sourceId === sourceId)?.snapshot?.runId
    : null;

  useEffect(() => {
    if (!doneRunId || appliedRunIdRef.current === doneRunId) return;
    appliedRunIdRef.current = doneRunId;
    void handleApplied();
  }, [doneRunId, handleApplied]);

  if (!sourceId) return null;

  if (variant === "header-date") {
    return (
      <p
        className={cn(
          "max-w-[10rem] truncate font-mono text-[0.5625rem] text-muted sm:max-w-[14rem]",
          className,
        )}
        title={absolute}
      >
        Updated {relative}
      </p>
    );
  }

  if (variant === "header-action") {
    return null;
  }

  if (!canUpdate) return null;

  return (
    <button
      type="button"
      onClick={startUpdate}
      title="Re-check every crawl root, not just the selected path"
      className={cn(
        "inline-flex shrink-0 items-center rounded-md border border-border bg-card-solid px-2 py-1 font-mono text-[0.5rem] font-semibold tracking-[0.08em] text-muted uppercase transition-colors hover:border-foreground/15 hover:text-foreground",
        className,
      )}
    >
      Update
    </button>
  );
}
