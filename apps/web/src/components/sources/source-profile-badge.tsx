"use client";

import { ScanSearch } from "lucide-react";
import { cn } from "@/lib/utils";

export function SourceProfileBadge({
  lensCount,
  onClick,
  className,
}: {
  lensCount?: number;
  onClick?: () => void;
  className?: string;
}) {
  const title =
    typeof lensCount === "number" && lensCount > 0
      ? `View profile (${lensCount} lenses)`
      : "View profile";

  const classes = cn(
    "inline-flex size-5 shrink-0 items-center justify-center rounded-md border border-accent/30 bg-accent/10 text-accent transition-colors hover:bg-accent/15",
    className,
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onClick();
        }}
        title={title}
        aria-label={title}
        className={classes}
      >
        <ScanSearch className="size-3" aria-hidden />
      </button>
    );
  }

  return (
    <span title={title} aria-label={title} className={classes}>
      <ScanSearch className="size-3" aria-hidden />
    </span>
  );
}
