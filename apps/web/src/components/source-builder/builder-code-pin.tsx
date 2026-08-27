"use client";

import { Check, Code2, Copy } from "lucide-react";
import { useState } from "react";
import { BuilderPinCard } from "@/components/source-builder/builder-pin-card";
import type { BuilderCodePin } from "@/lib/source-builder-draft";
import { cn } from "@/lib/utils";

export function BuilderCodePinCard({
  pin,
  onChange,
  onRemove,
}: {
  pin: BuilderCodePin;
  onChange?: (next: BuilderCodePin) => void;
  onRemove?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const editable = Boolean(onChange);
  const headerLabel =
    pin.title.trim() ||
    pin.filename?.trim() ||
    pin.language.trim() ||
    "code";

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(pin.code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  }

  return (
    <BuilderPinCard
      icon={Code2}
      title={pin.title || "Code"}
      onTitleChange={
        editable
          ? (title) => onChange?.({ ...pin, title })
          : undefined
      }
      titlePlaceholder="Code"
      onRemove={onRemove}
      removeLabel="Remove code block"
    >
      <div className="overflow-hidden border-t border-transparent">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/50 bg-surface-raised/60 px-3 py-1.5">
          {editable ? (
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
              <input
                value={pin.language}
                onChange={(event) =>
                  onChange?.({ ...pin, language: event.target.value })
                }
                className="w-24 rounded border border-border bg-background px-2 py-0.5 font-mono text-[10px] text-foreground outline-none"
                placeholder="lang"
                aria-label="Code language"
              />
              <input
                value={pin.filename ?? ""}
                onChange={(event) =>
                  onChange?.({ ...pin, filename: event.target.value })
                }
                className="w-32 rounded border border-border bg-background px-2 py-0.5 font-mono text-[10px] text-foreground outline-none"
                placeholder="filename"
                aria-label="Code filename"
              />
            </div>
          ) : (
            <span className="truncate font-mono text-[10px] uppercase tracking-[0.1em] text-muted">
              {headerLabel}
              {pin.language ? ` · ${pin.language}` : ""}
            </span>
          )}
          <button
            type="button"
            onClick={() => void copyCode()}
            className={cn(
              "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-muted transition-colors hover:bg-surface-raised hover:text-foreground",
            )}
            aria-label="Copy code"
          >
            {copied ? (
              <Check className="size-3" />
            ) : (
              <Copy className="size-3" />
            )}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        {editable ? (
          <textarea
            value={pin.code}
            onChange={(event) =>
              onChange?.({ ...pin, code: event.target.value })
            }
            rows={10}
            spellCheck={false}
            className="min-h-[10rem] w-full resize-y bg-[#f6f8fa] p-3 font-mono text-[11px] leading-relaxed text-[#24292f] outline-none dark:bg-[#1a1a1b] dark:text-[#e6edf3]"
            aria-label="Code source"
          />
        ) : (
          <pre className="overflow-x-auto bg-[#f6f8fa] p-3 font-mono text-[11px] leading-relaxed text-[#24292f] dark:bg-[#1a1a1b] dark:text-[#e6edf3]">
            <code>{pin.code}</code>
          </pre>
        )}
      </div>
    </BuilderPinCard>
  );
}
