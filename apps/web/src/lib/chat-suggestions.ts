import { cn } from "@/lib/utils";

/** Drives chip color in the suggestion row. */
export type SuggestionTagVariant =
  | "full"
  | "tier2"
  | "multi"
  | "below"
  | "catalog"
  | "single"
  | "neutral";

export type ChatSuggestion = {
  text: string;
  /** What this prompt is meant to exercise, e.g. "Single · Tier 2". */
  tag?: string;
  tagVariant?: SuggestionTagVariant;
};

export type ChatSuggestionInput = string | ChatSuggestion;

export function normalizeChatSuggestion(
  input: ChatSuggestionInput,
): ChatSuggestion {
  return typeof input === "string" ? { text: input } : input;
}

export function suggestionTagClassName(
  variant: SuggestionTagVariant = "neutral",
): string {
  return cn(
    "shrink-0 rounded px-1 py-0.5 text-[0.5625rem] font-semibold uppercase tracking-wide",
    variant === "full" &&
      "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
    variant === "tier2" && "bg-sky-500/15 text-sky-600 dark:text-sky-400",
    variant === "multi" &&
      "bg-violet-500/15 text-violet-600 dark:text-violet-400",
    variant === "below" &&
      "bg-amber-500/15 text-amber-600 dark:text-amber-400",
    variant === "catalog" &&
      "bg-orange-500/15 text-orange-600 dark:text-orange-400",
    variant === "single" && "bg-muted/40 text-muted",
    variant === "neutral" && "bg-muted/40 text-muted",
  );
}

export function suggestionChipClassName(
  variant: SuggestionTagVariant = "neutral",
): string | undefined {
  switch (variant) {
    case "full":
      return "border-emerald-500/35";
    case "tier2":
      return "border-sky-500/35";
    case "multi":
      return "border-violet-500/35";
    case "below":
    case "catalog":
      return "border-amber-500/35";
    default:
      return undefined;
  }
}
