"use client";

import { cn } from "@/lib/utils";

export function DeepThinkingToggle({
  enabled,
  onChange,
  disabled = false,
  className,
  title,
}: {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
  disabled?: boolean;
  className?: string;
  title?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label="Deep thinking"
      title={title}
      disabled={disabled}
      onClick={() => onChange(!enabled)}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
        enabled
          ? "border-accent bg-accent/10 text-accent"
          : "border-border bg-card-solid text-muted hover:text-foreground",
        disabled && "cursor-not-allowed opacity-50",
        className,
      )}
    >
      <span className="text-sm leading-none" aria-hidden>
        ◈
      </span>
      Deep thinking
    </button>
  );
}
