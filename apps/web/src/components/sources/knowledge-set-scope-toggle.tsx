"use client";

import { Lock } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/utils";

export type KnowledgeSetScope = "personal" | "global";

export function KnowledgeSetScopeToggle({
  value,
  onChange,
  className,
  disabled = false,
  size = "default",
  /** When true, Public stays visible but can't be selected (admin-only publish). */
  publicLocked = false,
}: {
  value: KnowledgeSetScope;
  onChange: (value: KnowledgeSetScope) => void;
  className?: string;
  disabled?: boolean;
  size?: "default" | "compact";
  publicLocked?: boolean;
}) {
  const { isAdmin } = useAuth();
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
      aria-label="Visibility"
      aria-disabled={disabled || undefined}
    >
      {(
        [
          {
            id: "personal" as const,
            label: "Just me",
            title: "Only you can see this source",
            locked: false,
          },
          {
            id: "global" as const,
            label: "Public",
            title: publicLocked
              ? "Admin only — publish to the public catalog"
              : "Public catalog — visible to everyone (admin)",
            locked: publicLocked,
            adminOnly: true,
          },
        ] as const
      ).map((option) => {
        const optionDisabled = disabled || option.locked;
        return (
          <button
            key={option.id}
            type="button"
            role="tab"
            aria-selected={value === option.id}
            aria-disabled={optionDisabled || undefined}
            title={option.title}
            disabled={optionDisabled}
            onClick={() => {
              if (optionDisabled) return;
              onChange(option.id);
            }}
            className={cn(
              "inline-flex items-center gap-1 transition-colors",
              compact
                ? "rounded-[0.2rem] px-2 py-0.5 font-mono text-[0.5rem] font-semibold tracking-[0.08em] uppercase"
                : "rounded-md px-3 py-1.5 text-sm font-medium",
              value === option.id
                ? compact
                  ? "bg-card-solid text-foreground"
                  : "bg-card-solid text-foreground shadow-card"
                : option.locked
                  ? "cursor-not-allowed text-muted/70"
                  : "text-muted hover:text-foreground",
            )}
          >
            {option.locked ? (
              <Lock
                className={compact ? "size-2.5" : "size-3.5"}
                aria-hidden
              />
            ) : null}
            <span>{option.label}</span>
            {"adminOnly" in option && option.adminOnly && isAdmin ? (
              <span
                className={cn(
                  "rounded font-mono font-semibold tracking-[0.08em] uppercase",
                  compact
                    ? "text-[0.4375rem] opacity-70"
                    : "ml-0.5 bg-surface-raised px-1 py-px text-[0.5rem] text-muted",
                )}
              >
                admin
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
