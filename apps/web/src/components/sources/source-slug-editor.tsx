"use client";

import { useEffect, useRef, useState } from "react";
import { updateSource } from "@/lib/ledgeindex-api";
import { cn } from "@/lib/utils";
import { isValidSourceSlug, slugifySourceSlug } from "./source-slug";

export function SourceSlugEditor({
  sourceId,
  slug,
  canEdit = false,
  onUpdated,
  className,
}: {
  sourceId: string;
  slug: string;
  canEdit?: boolean;
  onUpdated?: (nextSlug: string) => void;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(slug);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) setDraft(slug);
  }, [slug, editing]);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  function startEditing() {
    if (!canEdit || saving) return;
    setError(null);
    setDraft(slug);
    setEditing(true);
  }

  function cancelEditing() {
    setDraft(slug);
    setError(null);
    setEditing(false);
  }

  async function saveSlug() {
    const normalized = slugifySourceSlug(draft);
    if (!normalized) {
      setError("Slug is required");
      return;
    }
    if (!isValidSourceSlug(normalized)) {
      setError("Use lowercase letters, numbers, and hyphens");
      return;
    }
    if (normalized === slug) {
      setEditing(false);
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const { source } = await updateSource(sourceId, { slug: normalized });
      onUpdated?.(source.slug);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update slug");
    } finally {
      setSaving(false);
    }
  }

  if (!canEdit) {
    return (
      <p
        className={cn(
          "truncate font-mono text-[0.6875rem] text-muted",
          className,
        )}
        title={`MCP slug: ${slug}`}
      >
        {slug}
      </p>
    );
  }

  if (!editing) {
    return (
      <div className={cn("flex min-w-0 items-center gap-1.5", className)}>
        <button
          type="button"
          onClick={startEditing}
          className="group flex min-w-0 items-center gap-1.5 rounded-md border border-transparent px-1 py-0.5 text-left transition-colors hover:border-border hover:bg-surface-raised"
          title="Edit MCP slug"
        >
          <span className="truncate font-mono text-[0.6875rem] text-muted group-hover:text-foreground">
            {slug}
          </span>
          <PencilIcon className="size-3 shrink-0 text-muted opacity-0 transition-opacity group-hover:text-foreground group-hover:opacity-100" />
        </button>
      </div>
    );
  }

  return (
    <div className={cn("space-y-1", className)}>
      <div className="flex min-w-0 items-center gap-1.5">
        <input
          ref={inputRef}
          type="text"
          value={draft}
          disabled={saving}
          onChange={(event) => {
            setDraft(slugifySourceSlug(event.target.value));
            setError(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void saveSlug();
            }
            if (event.key === "Escape") {
              event.preventDefault();
              cancelEditing();
            }
          }}
          className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 font-mono text-[0.6875rem] text-foreground outline-none ring-accent focus:ring-1"
          aria-label="Source slug"
          spellCheck={false}
        />
        <button
          type="button"
          disabled={saving}
          onClick={() => void saveSlug()}
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
      ) : (
        <p className="font-mono text-[0.625rem] text-muted">
          Used by MCP tools, e.g. ask_source
        </p>
      )}
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
