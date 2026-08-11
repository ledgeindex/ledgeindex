"use client";

import { LayoutGrid, List } from "lucide-react";
import { cn } from "@/lib/utils";

export type DashboardViewMode = "grid" | "list";

export function DashboardViewToggle({
  value,
  onChange,
}: {
  value: DashboardViewMode;
  onChange: (value: DashboardViewMode) => void;
}) {
  return (
    <div
      className="inline-flex rounded-lg border border-border bg-card-solid p-0.5 shadow-card"
      role="group"
      aria-label="View mode"
    >
      <button
        type="button"
        onClick={() => onChange("list")}
        aria-label="List view"
        className={cn(
          "inline-flex size-8 items-center justify-center rounded-md transition-colors",
          value === "list"
            ? "bg-foreground text-background"
            : "text-muted hover:text-foreground",
        )}
        aria-pressed={value === "list"}
      >
        <List className="size-3.5" aria-hidden />
      </button>
      <button
        type="button"
        onClick={() => onChange("grid")}
        aria-label="Bookshelf view"
        className={cn(
          "inline-flex size-8 items-center justify-center rounded-md transition-colors",
          value === "grid"
            ? "bg-foreground text-background"
            : "text-muted hover:text-foreground",
        )}
        aria-pressed={value === "grid"}
      >
        <LayoutGrid className="size-3.5" aria-hidden />
      </button>
    </div>
  );
}
