"use client";

import { Cloud } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SourceSummary } from "@/lib/ledgeindex-api";

/** Personal set stored on LedgeIndex cloud (not the local sidecar). */
export function isPersonalCloudSource(
  source: Pick<SourceSummary, "scope" | "hosting">,
): boolean {
  return source.scope === "personal" && source.hosting === "cloud";
}

export function SourceCloudBadge({
  className,
  size = "default",
}: {
  className?: string;
  size?: "default" | "sm";
}) {
  return (
    <span
      title="Hosted in the cloud"
      aria-label="Hosted in the cloud"
      className={cn(
        "inline-flex items-center justify-center rounded-md border border-border/80 bg-card-solid/95 text-muted shadow-card",
        size === "sm" ? "size-5" : "size-6",
        className,
      )}
    >
      <Cloud
        className={size === "sm" ? "size-3" : "size-3.5"}
        aria-hidden
      />
    </span>
  );
}
