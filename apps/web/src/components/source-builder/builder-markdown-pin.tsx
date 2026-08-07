"use client";

import { FileText } from "lucide-react";
import { useState } from "react";
import { Streamdown } from "streamdown";
import { BuilderPinCard } from "@/components/source-builder/builder-pin-card";
import type { BuilderMarkdownPin } from "@/lib/source-builder-draft";
import { streamdownChatComponents } from "@/lib/streamdown-chat-components";
import { streamdownDefaultProps } from "@/lib/streamdown-config";
import { cn } from "@/lib/utils";

type ViewMode = "preview" | "source";

function ViewToggle({
  viewMode,
  onChange,
}: {
  viewMode: ViewMode;
  onChange: (mode: ViewMode) => void;
}) {
  const options: { value: ViewMode; label: string }[] = [
    { value: "preview", label: "Preview" },
    { value: "source", label: "Source" },
  ];

  return (
    <div
      className="flex items-center gap-px rounded-md border border-border/50 p-0.5"
      role="group"
      aria-label="Markdown view"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={cn(
            "h-6 rounded px-2 text-[10px] font-medium uppercase tracking-[0.08em] transition-colors",
            viewMode === option.value
              ? "bg-surface-raised text-foreground shadow-sm"
              : "text-muted hover:text-foreground",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function BuilderMarkdownPin({
  pin,
  onChange,
  onRemove,
}: {
  pin: BuilderMarkdownPin;
  onChange?: (next: BuilderMarkdownPin) => void;
  onRemove?: () => void;
}) {
  const [viewMode, setViewMode] = useState<ViewMode>(
    onChange ? "source" : "preview",
  );
  const editable = Boolean(onChange);

  return (
    <BuilderPinCard
      icon={FileText}
      title={pin.title || "Markdown"}
      onRemove={onRemove}
      removeLabel="Remove markdown"
      headerTrailing={
        <ViewToggle viewMode={viewMode} onChange={setViewMode} />
      }
    >
      <div className="min-h-0 overflow-y-auto p-4">
        {viewMode === "preview" ? (
          <div className="chat-md prose-sm max-w-none text-sm leading-relaxed text-foreground">
            <Streamdown
              components={streamdownChatComponents}
              {...streamdownDefaultProps}
            >
              {pin.markdown || "_Empty markdown_"}
            </Streamdown>
          </div>
        ) : editable ? (
          <div className="space-y-2">
            <input
              value={pin.title}
              onChange={(event) =>
                onChange?.({ ...pin, title: event.target.value })
              }
              className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-foreground outline-none ring-accent focus:ring-1"
              placeholder="Pin title"
              aria-label="Markdown pin title"
            />
            <textarea
              value={pin.markdown}
              onChange={(event) =>
                onChange?.({ ...pin, markdown: event.target.value })
              }
              rows={12}
              spellCheck={false}
              className="min-h-[12rem] w-full resize-y rounded-md border border-border bg-background px-3 py-2 font-mono text-[11px] leading-relaxed text-foreground outline-none ring-accent focus:ring-1"
              aria-label="Markdown source"
              placeholder="# Write documentation…"
            />
          </div>
        ) : (
          <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-muted-strong">
            {pin.markdown}
          </pre>
        )}
      </div>
    </BuilderPinCard>
  );
}
