"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatSourceCategoryLabel } from "@/lib/source-category";
import {
  mergeSourceCategories,
  SOURCE_KIND_PRESETS,
  SOURCE_LANGUAGE_PRESETS,
  splitSourceCategories,
} from "@/lib/source-category-presets";
import { updateSourceCategories } from "@/lib/ledgeindex-api";
import type { SourceSummary } from "@/lib/ledgeindex-api";
import { cn } from "@/lib/utils";

export function SourceCategoriesDialog({
  source,
  open,
  onOpenChange,
  onSaved,
}: {
  source: SourceSummary;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: (categories: string[]) => void;
}) {
  const [kind, setKind] = useState<string | null>(null);
  const [languages, setLanguages] = useState<string[]>([]);
  const [custom, setCustom] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const draft = useMemo(
    () => mergeSourceCategories({ kind, languages, custom }),
    [kind, languages, custom],
  );

  useEffect(() => {
    if (!open) return;
    const parsed = splitSourceCategories(source.categories ?? []);
    setKind(parsed.kind);
    setLanguages(parsed.languages);
    setCustom(parsed.custom);
    setError(null);
  }, [open, source.categories, source.id]);

  if (!open) return null;

  function toggleLanguage(slug: string) {
    setLanguages((current) =>
      current.includes(slug)
        ? current.filter((entry) => entry !== slug)
        : [...current, slug].sort(),
    );
    setError(null);
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const { source: updated } = await updateSourceCategories(source.id, draft);
      onSaved?.(updated.categories ?? draft);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save categories");
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
        onClick={() => onOpenChange(false)}
      />
      <div className="relative z-[1] w-full max-w-md rounded-xl border border-border bg-card-solid p-5 shadow-card">
        <h2 className="text-sm font-semibold text-foreground">Set categories</h2>
        <p className="mt-1 text-xs text-muted">
          Assign <span className="text-foreground">{source.name}</span> to a
          bookshelf shelf, then optionally tag languages.
        </p>

        <div className="mt-4 space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-[0.625rem] font-semibold tracking-[0.08em] text-muted uppercase">
              Shelf
            </span>
            <div className="relative">
              <select
                value={kind ?? ""}
                onChange={(event) => {
                  setKind(event.target.value || null);
                  setError(null);
                }}
                className="field-input w-full appearance-none pr-8 font-sans text-xs normal-case"
              >
                <option value="">Choose shelf…</option>
                {SOURCE_KIND_PRESETS.map((entry) => (
                  <option key={entry.slug} value={entry.slug}>
                    {entry.label}
                  </option>
                ))}
              </select>
              <ChevronDown
                className="pointer-events-none absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2 text-muted"
                aria-hidden
              />
            </div>
          </label>

          <div>
            <span className="mb-1.5 block text-[0.625rem] font-semibold tracking-[0.08em] text-muted uppercase">
              Languages (optional)
            </span>
            <div className="flex flex-wrap gap-1.5">
              {SOURCE_LANGUAGE_PRESETS.map((entry) => {
                const active = languages.includes(entry.slug);
                return (
                  <button
                    key={entry.slug}
                    type="button"
                    aria-pressed={active}
                    onClick={() => toggleLanguage(entry.slug)}
                    className={cn(
                      "inline-flex items-center rounded-full border px-2.5 py-1 font-mono text-[0.5625rem] font-semibold tracking-[0.06em] uppercase transition-colors",
                      active
                        ? "border-foreground/20 bg-foreground text-background"
                        : "border-border bg-surface-raised text-muted hover:border-foreground/15 hover:text-foreground",
                    )}
                  >
                    {entry.label}
                  </button>
                );
              })}
            </div>
          </div>

          {custom.length > 0 ? (
            <div>
              <span className="mb-1.5 block text-[0.625rem] font-semibold tracking-[0.08em] text-muted uppercase">
                Other tags
              </span>
              <div className="flex flex-wrap gap-1.5">
                {custom.map((slug) => (
                  <span
                    key={slug}
                    className="inline-flex items-center rounded-md border border-border bg-surface-raised px-2 py-1 font-mono text-[0.5625rem] font-semibold tracking-[0.08em] text-foreground uppercase"
                  >
                    {formatSourceCategoryLabel(slug)}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
        </div>

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
          <Button type="button" onClick={() => void handleSave()} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </div>
  );
}
