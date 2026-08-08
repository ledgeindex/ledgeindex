"use client";

import { cn } from "@/lib/utils";
import type { ComponentProps, ReactNode } from "react";

export type SuggestionsProps = ComponentProps<"div">;

export function Suggestions({
  className,
  children,
  ...props
}: SuggestionsProps) {
  return (
    <div
      className={cn("flex min-w-0 flex-wrap gap-2", className)}
      {...props}
    >
      {children}
    </div>
  );
}

export type SuggestionProps = {
  suggestion: string;
  onClick?: (suggestion: string) => void;
  disabled?: boolean;
  className?: string;
  children?: ReactNode;
};

export function Suggestion({
  suggestion,
  onClick,
  disabled = false,
  className,
  children,
}: SuggestionProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onClick?.(suggestion)}
      className={cn(
        "max-w-full truncate rounded-full border border-border bg-card-solid px-3 py-1.5 text-left text-xs font-medium text-muted transition-colors",
        "hover:bg-surface-raised hover:text-foreground",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
    >
      {children ?? suggestion}
    </button>
  );
}
