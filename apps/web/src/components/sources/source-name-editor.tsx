"use client";

import { useEffect, useRef, useState } from "react";
import { updateSource } from "@/lib/ledgeindex-api";
import { cn } from "@/lib/utils";

export function SourceNameEditor({
  sourceId,
  name,
  canEdit = false,
  onUpdated,
  className,
}: {
  sourceId: string;
  name: string;
  canEdit?: boolean;
  onUpdated?: (nextName: string) => void;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) setDraft(name);
  }, [name, editing]);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  function startEditing() {
    if (!canEdit || saving) return;
    setError(null);
    setDraft(name);
    setEditing(true);
  }

  function cancelEditing() {
    setDraft(name);
    setError(null);
    setEditing(false);
  }

  async function saveName() {
    const normalized = draft.trim().replace(/\s+/g, " ");
    if (!normalized) {
      setError("Title is required");
      return;
    }
    if (normalized.length > 200) {
      setError("Title must be 200 characters or less");
      return;
    }
    if (normalized === name) {
      setEditing(false);
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const { source } = await updateSource(sourceId, { name: normalized });
      onUpdated?.(source.name);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update title");
    } finally {
      setSaving(false);
    }
  }

  if (!canEdit) {
    return (
      <h2
        className={cn(
          "truncate text-sm font-semibold text-foreground",
          className,
        )}
        title={name}
      >
        {name}
      </h2>
    );
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={startEditing}
        className={cn(
          "group flex min-w-0 max-w-full items-center gap-1.5 rounded-md border border-transparent px-1 py-0.5 text-left transition-colors hover:border-border hover:bg-surface-raised",
          className,
        )}
        title="Edit title"
      >
        <span className="truncate text-sm font-semibold text-foreground">
          {name}
        </span>
        <PencilIcon className="size-3 shrink-0 text-muted opacity-0 transition-opacity group-hover:text-foreground group-hover:opacity-100" />
      </button>
    );
  }

  return (
    <div className={cn("min-w-0 space-y-1", className)}>
      <div className="flex min-w-0 items-center gap-1.5">
        <input
          ref={inputRef}
          type="text"
          value={draft}
          disabled={saving}
          maxLength={200}
          onChange={(event) => {
            setDraft(event.target.value);
            setError(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void saveName();
            }
            if (event.key === "Escape") {
              event.preventDefault();
              cancelEditing();
            }
          }}
          className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-sm font-semibold text-foreground outline-none ring-accent focus:ring-1"
          aria-label="Source title"
        />
        <button
          type="button"
          disabled={saving}
          onClick={() => void saveName()}
          className="shrink-0 rounded-md border border-border px-2 py-1 font-mono text-[0.625rem] font-semibold text-foreground hover:bg-surface-raised disabled:opacity-50"
        >
          {saving ? "…" : "Save"}
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={cancelEditing}
          className="shrink-0 rounded-md px-1.5 py-1 font-mono text-[0.625rem] text-muted hover:text-foreground disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
      {error ? (
        <p className="font-mono text-[0.625rem] text-red-600 dark:text-red-300">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function PencilIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="currentColor"
      className={className}
      aria-hidden
    >
      <path d="m13.84 3.16 3 3-9.19 9.19-3.75.75.75-3.75L13.84 3.16ZM14.9 2.1a1 1 0 0 1 1.41 0l1.59 1.59a1 1 0 0 1 0 1.41l-1.07 1.07-3-3L14.9 2.1Z" />
    </svg>
  );
}
