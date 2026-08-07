"use client";

import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export function HeaderSelect<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
  className,
}: {
  value: T;
  onChange: (value: T) => void;
  options: readonly { value: T; label: string }[];
  ariaLabel: string;
  className?: string;
}) {
  return (
    <label
      className={cn(
        "relative inline-flex h-8 min-w-0 shrink-0 items-center",
        className,
      )}
    >
      <span className="sr-only">{ariaLabel}</span>
      <select
        value={value}
        aria-label={ariaLabel}
        onChange={(event) => onChange(event.target.value as T)}
        className="h-8 max-w-[8.5rem] appearance-none truncate rounded-lg border border-border bg-card-solid py-0 pl-2 pr-6 text-xs font-medium text-foreground shadow-card transition-colors hover:bg-surface-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 sm:max-w-[10rem]"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-2 size-3.5 text-muted"
        aria-hidden
      />
    </label>
  );
}
