"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { isValidSourceSlug, slugifySourceSlug } from "@/components/sources/source-slug";
import { updateSource } from "@/lib/ledgeindex-api";

export type SourceRenameField = "name" | "slug";

export function SourceRenameDialog({
  sourceId,
  field,
  initialValue,
  open,
  onOpenChange,
  onSaved,
}: {
  sourceId: string;
  field: SourceRenameField;
  initialValue: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: (nextValue: string) => void;
}) {
  const [draft, setDraft] = useState(initialValue);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const isSlug = field === "slug";
  const title = isSlug ? "Rename slug" : "Rename title";

  useEffect(() => {
    if (!open) return;
    setDraft(initialValue);
    setError(null);
    const timer = window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [open, initialValue]);

  if (!open) return null;

  async function handleSave() {
    if (isSlug) {
      const normalized = slugifySourceSlug(draft);
      if (!normalized) {
        setError("Slug is required");
        return;
      }
      if (!isValidSourceSlug(normalized)) {
        setError("Use lowercase letters, numbers, and hyphens");
        return;
      }
      if (normalized === initialValue) {
        onOpenChange(false);
        return;
      }
      setSaving(true);
      setError(null);
      try {
        const { source } = await updateSource(sourceId, { slug: normalized });
        onSaved?.(source.slug);
        onOpenChange(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to update slug");
      } finally {
        setSaving(false);
      }
      return;
    }

    const normalized = draft.trim().replace(/\s+/g, " ");
    if (!normalized) {
      setError("Title is required");
      return;
    }
    if (normalized.length > 200) {
      setError("Title must be 200 characters or less");
      return;
    }
    if (normalized === initialValue) {
      onOpenChange(false);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const { source } = await updateSource(sourceId, { name: normalized });
      onSaved?.(source.name);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update title");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 bg-black/50"
        onClick={() => !saving && onOpenChange(false)}
      />
      <div className="relative z-[1] w-full max-w-md rounded-xl border border-border bg-card-solid p-5 shadow-card">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        <p className="mt-1 text-xs text-muted">
          {isSlug
            ? "Used by MCP tools, e.g. ask_source."
            : "Display name shown on the bookshelf and in chat."}
        </p>

        <label className="mt-4 block">
          <span className="mb-1.5 block text-[0.625rem] font-semibold tracking-[0.08em] text-muted uppercase">
            {isSlug ? "Slug" : "Title"}
          </span>
          <input
            ref={inputRef}
            type="text"
            value={draft}
            disabled={saving}
            maxLength={isSlug ? 64 : 200}
            spellCheck={!isSlug}
            onChange={(event) => {
              setDraft(
                isSlug
                  ? slugifySourceSlug(event.target.value)
                  : event.target.value,
              );
              setError(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void handleSave();
              }
              if (event.key === "Escape") {
                event.preventDefault();
                if (!saving) onOpenChange(false);
              }
            }}
            className={
              isSlug
                ? "field-input w-full font-mono text-xs normal-case"
                : "field-input w-full text-sm normal-case"
            }
          />
        </label>

        {error ? (
          <p className="mt-3 text-xs text-red-600 dark:text-red-300">{error}</p>
        ) : null}

        <div className="mt-5 flex justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving}
          >
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </div>
  );
}
