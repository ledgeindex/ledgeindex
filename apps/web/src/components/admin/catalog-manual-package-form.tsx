"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { FilterBadge } from "@/components/sources/source-category-filter";
import { upsertCatalogPackage } from "@/lib/admin-docs-catalog-api";
import type { TypescriptDocsCatalogEntry } from "@/lib/typescript-docs-catalog";

export function CatalogManualPackageForm({
  canPersist,
  onSaved,
}: {
  canPersist: boolean;
  onSaved: (next: TypescriptDocsCatalogEntry) => void;
}) {
  const [open, setOpen] = useState(false);
  const [packageName, setPackageName] = useState("");
  const [docsUrl, setDocsUrl] = useState("");
  const [pathUrl, setPathUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!canPersist) {
      setError("Only available in local development.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const entry = await upsertCatalogPackage({
        packageName: packageName.trim(),
        docsUrl: docsUrl.trim(),
        pathUrl: pathUrl.trim() || undefined,
      });
      onSaved(entry);
      setPackageName("");
      setDocsUrl("");
      setPathUrl("");
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Add failed");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <FilterBadge
        active={false}
        disabled={!canPersist}
        onClick={() => setOpen(true)}
        title={
          canPersist
            ? "Manually add a package / docs URL to the JSON list"
            : "Only in local development"
        }
      >
        <Plus className="size-3" aria-hidden />
        Add package URL
      </FilterBadge>
    );
  }

  return (
    <div className="flex w-full flex-col gap-1.5 rounded-md border border-border bg-card-solid p-2 sm:max-w-xl">
      <p className="font-mono text-[0.5rem] font-semibold tracking-[0.12em] text-muted uppercase">
        Manual package
      </p>
      <div className="flex flex-wrap gap-1.5">
        <input
          type="text"
          value={packageName}
          onChange={(event) => setPackageName(event.target.value)}
          placeholder="package name"
          className="h-8 min-w-[8rem] flex-1 rounded-md border border-border bg-background px-2.5 text-xs text-foreground placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/20"
        />
        <input
          type="url"
          value={docsUrl}
          onChange={(event) => setDocsUrl(event.target.value)}
          placeholder="docs URL"
          className="h-8 min-w-[12rem] flex-[2] rounded-md border border-border bg-background px-2.5 font-mono text-[0.6875rem] text-foreground placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/20"
        />
        <input
          type="url"
          value={pathUrl}
          onChange={(event) => setPathUrl(event.target.value)}
          placeholder="extra path URL (optional)"
          className="h-8 min-w-[12rem] flex-[2] rounded-md border border-border bg-background px-2.5 font-mono text-[0.6875rem] text-foreground placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/20"
        />
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <FilterBadge
          active
          disabled={busy || !packageName.trim() || !docsUrl.trim()}
          onClick={() => void submit()}
        >
          {busy ? "Adding…" : "Add to JSON"}
        </FilterBadge>
        <FilterBadge
          active={false}
          disabled={busy}
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
        >
          Cancel
        </FilterBadge>
        {error ? (
          <p className="text-[0.625rem] text-red-600 dark:text-red-300">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
