"use client";

import { useEffect } from "react";
import { useOptionalSourceRefreshJobs } from "@/contexts/source-refresh-jobs-context";

/** Starts a background refresh and opens the header panel. Does not block the page. */
export function SourceRefreshDialog({
  sourceId,
  sourceName,
  sourceStartUrl,
  sourceScope = "personal",
  sourceHosting,
  open,
  onOpenChange,
  onApplied,
}: {
  sourceId: string;
  sourceName: string;
  sourceStartUrl: string;
  sourceScope?: "personal" | "global";
  sourceHosting?: "local" | "cloud";
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApplied?: () => void;
}) {
  const jobs = useOptionalSourceRefreshJobs();
  const startJob = jobs?.startJob;
  const done =
    jobs?.jobs.find((job) => job.sourceId === sourceId)?.snapshot?.status ===
    "done";

  useEffect(() => {
    if (!open || !startJob) return;
    void startJob({
      sourceId,
      sourceName,
      sourceStartUrl,
      sourceScope,
      hosting: sourceHosting,
    });
    onOpenChange(false);
  }, [
    onOpenChange,
    open,
    sourceHosting,
    sourceId,
    sourceName,
    sourceScope,
    sourceStartUrl,
    startJob,
  ]);

  useEffect(() => {
    if (done) onApplied?.();
  }, [done, onApplied]);

  return null;
}
