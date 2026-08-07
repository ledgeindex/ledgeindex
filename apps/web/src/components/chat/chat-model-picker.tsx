"use client";

import Link from "next/link";
import type { LedgeIndexChatModel, LedgeIndexChatModelId } from "@/lib/chat-models";
import { cn } from "@/lib/utils";

export function ChatModelPicker({
  modelId,
  onChange,
  models,
  needsProviderKeys = false,
  className,
}: {
  modelId: LedgeIndexChatModelId;
  onChange: (modelId: LedgeIndexChatModelId) => void;
  models: readonly LedgeIndexChatModel[];
  needsProviderKeys?: boolean;
  className?: string;
}) {
  if (needsProviderKeys) {
    return (
      <div className={cn("flex flex-wrap items-center gap-2", className)}>
        <Link
          href="/settings/providers"
          className="rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-900 dark:text-amber-100"
        >
          Add API key
        </Link>
        <span className="text-xs text-muted">
          OpenAI, Gemini, or DeepSeek required for local chat
        </span>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      {models.map((model) => (
        <button
          key={model.id}
          type="button"
          onClick={() => onChange(model.id)}
          className={cn(
            "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
            modelId === model.id
              ? "border-foreground bg-foreground text-background"
              : "border-border bg-card-solid text-muted hover:text-foreground",
          )}
        >
          {model.label}
        </button>
      ))}
    </div>
  );
}
