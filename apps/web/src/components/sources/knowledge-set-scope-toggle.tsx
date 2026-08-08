"use client";

import { cn } from "@/lib/utils";

export type KnowledgeSetScope = "personal" | "global";

export function KnowledgeSetScopeToggle({
  value,
  onChange,
  className,
  disabled = false,
  size = "default",
}: {
  value: KnowledgeSetScope;
  onChange: (value: KnowledgeSetScope) => void;
  className?: string;
  disabled?: boolean;
  size?: "default" | "compact";
}) {
  const compact = size === "compact";

  return (
    <div
      className={cn(
        "inline-flex border border-border bg-surface-raised/80 p-0.5 shadow-card",
        compact ? "rounded-md shadow-none" : "rounded-lg",
        disabled && "pointer-events-none opacity-50",
        className,
      )}
      role="tablist"
      aria-label="Source scope"
      aria-disabled={disabled || undefined}
    >
      {(
        [
          { id: "personal" as const, label: "Personal" },
          { id: "global" as const, label: "Public" },
        ] as const
      ).map((option) => (
        <button
          key={option.id}
          type="button"
          role="tab"
          aria-selected={value === option.id}
          disabled={disabled}
          onClick={() => {
            if (disabled) return;
            onChange(option.id);
          }}
          className={cn(
            "transition-colors",
            compact
              ? "rounded-[0.2rem] px-2 py-0.5 font-mono text-[0.5rem] font-semibold tracking-[0.08em] uppercase"
              : "rounded-md px-3 py-1.5 text-sm font-medium",
            value === option.id
              ? compact
                ? "bg-card-solid text-foreground"
                : "bg-card-solid text-foreground shadow-card"
              : "text-muted hover:text-foreground",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
