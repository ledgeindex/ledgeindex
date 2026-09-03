"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { updateSource, type SourceSummary } from "@/lib/ledgeindex-api";

export function SourceVersionsDialog({
  source,
  open,
  onOpenChange,
  onSaved,
}: {
  source: SourceSummary;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setEditingId(null);
      setError(null);
    }
  }, [open]);

  useEffect(() => {
    if (!editingId) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [editingId]);

  if (!open) return null;

  async function saveLabel() {
    if (!editingId) return;
    const versionLabel = draft.trim().replace(/\s+/g, " ");
    if (!versionLabel) {
      setError("Version label is required");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await updateSource(
        editingId,
        { versionLabel },
        { scope: source.scope, hosting: source.hosting }
      );
      setEditingId(null);
      onSaved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to rename version");
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
      <div className="relative z-[1] w-full max-w-lg rounded-xl border border-border bg-card-solid p-5 shadow-card">
        <h2 className="text-sm font-semibold text-foreground">
          Manage versions
        </h2>
        <p className="mt-1 text-xs text-muted">
          Version labels can be used by the SDK to target an exact index.
        </p>

        <div className="mt-4 max-h-[22rem] space-y-2 overflow-y-auto">
          {source.versions.map((version) => {
            const editing = editingId === version.id;
            return (
              <div
                key={version.id}
                className="rounded-lg border border-border bg-surface-raised p-3"
              >
                {editing ? (
                  <div className="flex items-center gap-2">
                    <input
                      ref={inputRef}
                      value={draft}
                      maxLength={120}
                      disabled={saving}
                      onChange={(event) => {
                        setDraft(event.target.value);
                        setError(null);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          void saveLabel();
                        }
                        if (event.key === "Escape" && !saving) {
                          setEditingId(null);
                          setError(null);
                        }
                      }}
                      className="field-input min-w-0 flex-1 font-mono text-xs normal-case"
                    />
                    <Button
                      type="button"
                      onClick={() => void saveLabel()}
                      disabled={saving}
                    >
                      {saving ? "Saving…" : "Save"}
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-mono text-xs font-medium text-foreground">
                        {version.versionLabel}
                      </p>
                      <p className="mt-0.5 text-[0.625rem] text-muted">
                        Version {version.versionNumber} · {version.chunkCount}{" "}
                        chunks
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => {
                        setEditingId(version.id);
                        setDraft(version.versionLabel);
                        setError(null);
                      }}
                    >
                      Rename
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {error ? (
          <p className="mt-3 text-xs text-red-600 dark:text-red-300">{error}</p>
        ) : null}

        <div className="mt-5 flex justify-end">
          <Button
            type="button"
            variant="secondary"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Done
          </Button>
        </div>
      </div>
    </div>
  );
}
