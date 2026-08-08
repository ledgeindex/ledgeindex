"use client";

import { X } from "lucide-react";
import {
  normalizeChatSuggestion,
  suggestionTagClassName,
  type ChatSuggestionInput,
} from "@/lib/chat-suggestions";
import { cn } from "@/lib/utils";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

type Props = {
  open: boolean;
  onClose: () => void;
  onSelect: (prompt: string) => void;
  suggestions: readonly ChatSuggestionInput[];
};

export function ChatTestPromptsSheet({
  open,
  onClose,
  onSelect,
  suggestions,
}: Props) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

  if (!open || !mounted) return null;

  const handlePick = (prompt: string) => {
    onSelect(prompt);
    onClose();
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[300] flex items-end justify-end bg-black/45 p-0 sm:items-center sm:p-3 sm:pl-10"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="chat-test-prompts-title"
        className={cn(
          "flex h-[min(100dvh,100%)] w-full max-w-[28rem] flex-col overflow-hidden",
          "border-l border-border bg-card-solid shadow-card",
          "sm:h-[min(calc(100dvh-1.5rem),52rem)] sm:max-h-[calc(100dvh-1.5rem)] sm:rounded-2xl sm:border",
        )}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-4 py-3.5">
          <div className="min-w-0">
            <p className="mb-0.5 font-mono text-[0.58rem] font-semibold tracking-[0.14em] text-muted uppercase">
              Dev / admin
            </p>
            <h2
              id="chat-test-prompts-title"
              className="text-[1.05rem] font-semibold tracking-tight text-foreground"
            >
              Test prompts
            </h2>
            <p className="mt-1 text-[0.78rem] leading-snug text-muted">
              Click a prompt to drop it into the composer.
            </p>
          </div>
          <button
            type="button"
            className={cn(
              "inline-flex size-8 shrink-0 items-center justify-center rounded-lg",
              "border border-border bg-transparent text-muted",
              "hover:bg-surface-raised hover:text-foreground",
            )}
            onClick={onClose}
            aria-label="Close test prompts"
          >
            <X className="size-4" aria-hidden />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {suggestions.length === 0 ? (
            <p className="py-8 text-center text-[0.82rem] text-muted">
              No test prompts yet.
            </p>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {suggestions.map((raw) => {
                const { text, tag, tagVariant } = normalizeChatSuggestion(raw);
                return (
                  <li key={text}>
                    <button
                      type="button"
                      className={cn(
                        "flex w-full cursor-pointer flex-col gap-1.5 rounded-xl border border-border",
                        "bg-surface-raised/60 px-3.5 py-3 text-left",
                        "transition-colors hover:border-foreground/15 hover:bg-surface-raised",
                      )}
                      onClick={() => handlePick(text)}
                    >
                      {tag ? (
                        <span className={suggestionTagClassName(tagVariant)}>
                          {tag}
                        </span>
                      ) : (
                        <span className="text-[0.68rem] font-semibold tracking-wide text-muted uppercase">
                          Prompt
                        </span>
                      )}
                      <span className="text-[0.88rem] font-medium leading-snug text-foreground">
                        {text}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </aside>
    </div>,
    document.body,
  );
}
