"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Plus, Trash2 } from "lucide-react";
import { FilterBadge } from "@/components/sources/source-category-filter";
import {
  pathsEqual,
  saveCatalogPackagePaths,
  type CatalogPathDraft,
} from "@/lib/admin-docs-catalog-api";
import type {
  DocsPathKind,
  TypescriptDocsCatalogEntry,
} from "@/lib/typescript-docs-catalog";
import { cn } from "@/lib/utils";

const KIND_OPTIONS: DocsPathKind[] = [
  "guides",
  "api",
  "examples",
  "reference",
  "home",
  "other",
];

function draftFromEntry(entry: TypescriptDocsCatalogEntry): CatalogPathDraft[] {
  if (entry.paths.length > 0) {
    return entry.paths.map((path) => ({ ...path }));
  }
  if (entry.docs) {
    return [{ kind: "guides", url: entry.docs, label: "main" }];
  }
  return [];
}

function formatPathLabel(url: string): string {
  try {
    return new URL(url).pathname.replace(/\/+$/, "") || "/";
  } catch {
    return url;
  }
}

export function CatalogPathsMaintainPanel({
  entry,
  canPersist,
  onSaved,
}: {
  entry: TypescriptDocsCatalogEntry;
  canPersist: boolean;
  onSaved: (next: TypescriptDocsCatalogEntry) => void;
}) {
  const [draftPaths, setDraftPaths] = useState<CatalogPathDraft[]>(() =>
    draftFromEntry(entry),
  );
  const [addUrl, setAddUrl] = useState("");
  const [addKind, setAddKind] = useState<DocsPathKind>("guides");
  const [addLabel, setAddLabel] = useState("");
  const [busy, setBusy] = useState<"save" | "approve" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const pathFingerprint = entry.paths.map((path) => path.url).join("\n");

  useEffect(() => {
    setDraftPaths(draftFromEntry(entry));
    setAddUrl("");
    setAddLabel("");
    setError(null);
    setNotice(null);
    setBusy(null);
    // Reset only when the package or persisted path set changes (after save).
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional fingerprint
  }, [entry.package, entry.pathsStatus, pathFingerprint]);

  const baseline = useMemo(() => draftFromEntry(entry), [entry]);
  const dirty = !pathsEqual(draftPaths, baseline);
  const needsApprove =
    entry.pathsStatus !== "discovered" || dirty || !entry.pathsStatus;

  function removePath(url: string) {
    setDraftPaths((prev) => prev.filter((row) => row.url !== url));
    setNotice(null);
    setError(null);
  }

  function addPath() {
    const url = addUrl.trim();
    if (!url) {
      setError("Paste a full URL to add");
      return;
    }
    try {
      // validate
      new URL(url);
    } catch {
      setError("URL must be absolute (https://…)");
      return;
    }
    const key = url.replace(/\/+$/, "").toLowerCase();
    if (
      draftPaths.some(
        (row) => row.url.replace(/\/+$/, "").toLowerCase() === key,
      )
    ) {
      setError("That URL is already in the path set");
      return;
    }
    setDraftPaths((prev) => [
      ...prev,
      {
        kind: addKind,
        url,
        ...(addLabel.trim() ? { label: addLabel.trim() } : {}),
        confidence: 1,
      },
    ]);
    setAddUrl("");
    setAddLabel("");
    setError(null);
    setNotice(null);
  }

  async function persist(approve: boolean) {
    if (!canPersist) {
      setError("Path edits only save in local development.");
      return;
    }
    setBusy(approve ? "approve" : "save");
    setError(null);
    setNotice(null);
    try {
      const saved = await saveCatalogPackagePaths({
        packageName: entry.package,
        paths: draftPaths,
        approve,
        pathsReason: approve
          ? "Approved in Source updater (manual path review)"
          : entry.pathsReason || undefined,
      });
      onSaved(saved);
      setNotice(
        approve
          ? "Approved — wrote top-typescript-docs.json + synced catalog"
          : "Saved — wrote top-typescript-docs.json + synced catalog",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="space-y-2 rounded-lg border border-border bg-surface-alt/60 p-2.5">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-mono text-[0.5rem] font-semibold tracking-[0.12em] text-muted uppercase">
            Maintain paths
          </p>
          <p className="mt-0.5 text-[0.625rem] leading-4 text-muted">
            Add / remove section roots, then save or approve into the JSON
            starting list.
          </p>
        </div>
        {entry.pathsStatus ? (
          <span
            className={cn(
              "shrink-0 rounded-md border px-1.5 py-0.5 font-mono text-[0.5rem] font-semibold uppercase",
              entry.pathsStatus === "discovered"
                ? "border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                : entry.pathsStatus === "uncertain"
                  ? "border-amber-500/35 bg-amber-500/10 text-amber-800 dark:text-amber-300"
                  : entry.pathsStatus === "failed"
                    ? "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300"
                    : "border-border bg-background text-muted",
            )}
          >
            {entry.pathsStatus}
          </span>
        ) : (
          <span className="shrink-0 rounded-md border border-border bg-background px-1.5 py-0.5 font-mono text-[0.5rem] font-semibold text-muted uppercase">
            missing
          </span>
        )}
      </div>

      {entry.pathsReason ? (
        <p className="rounded-md border border-border/70 bg-background/70 px-2 py-1.5 text-[0.625rem] leading-4 text-muted-strong">
          {entry.pathsReason}
        </p>
      ) : null}

      {draftPaths.length === 0 ? (
        <p className="text-xs text-muted">No paths yet — add a URL below.</p>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-background">
          {draftPaths.map((path) => (
            <li
              key={path.url}
              className="flex items-start gap-2 px-2.5 py-1.5"
            >
              <div className="min-w-0 flex-1">
                <p className="font-mono text-[0.5625rem] font-semibold tracking-[0.06em] text-muted uppercase">
                  {path.kind}
                  {path.label ? ` · ${path.label}` : ""}
                </p>
                <a
                  href={path.url}
                  target="_blank"
                  rel="noreferrer"
                  className="block break-all font-mono text-[0.625rem] leading-4 text-foreground hover:text-accent hover:underline"
                >
                  {formatPathLabel(path.url)}
                </a>
              </div>
              <button
                type="button"
                className="mt-0.5 rounded-md border border-border p-1 text-muted hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-700 dark:hover:text-red-300"
                title="Remove path"
                aria-label={`Remove ${path.url}`}
                onClick={() => removePath(path.url)}
              >
                <Trash2 className="size-3" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="space-y-1.5 border-t border-border/70 pt-2">
        <p className="font-mono text-[0.5rem] font-semibold tracking-[0.12em] text-muted uppercase">
          Add path URL
        </p>
        <div className="flex flex-wrap gap-1.5">
          <select
            value={addKind}
            onChange={(event) =>
              setAddKind(event.target.value as DocsPathKind)
            }
            className="h-8 rounded-lg border border-border bg-card-solid px-2 font-mono text-[0.625rem] text-foreground"
            aria-label="Path kind"
          >
            {KIND_OPTIONS.map((kind) => (
              <option key={kind} value={kind}>
                {kind}
              </option>
            ))}
          </select>
          <input
            type="text"
            value={addLabel}
            onChange={(event) => setAddLabel(event.target.value)}
            placeholder="Label (optional)"
            className="h-8 min-w-[7rem] flex-1 rounded-lg border border-border bg-card-solid px-2.5 text-xs text-foreground placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          />
        </div>
        <div className="flex gap-1.5">
          <input
            type="url"
            value={addUrl}
            onChange={(event) => setAddUrl(event.target.value)}
            placeholder="https://…"
            className="h-8 min-w-0 flex-1 rounded-lg border border-border bg-card-solid px-2.5 font-mono text-[0.6875rem] text-foreground placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                addPath();
              }
            }}
          />
          <FilterBadge active={false} onClick={addPath}>
            <Plus className="size-3" aria-hidden />
            Add
          </FilterBadge>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5 pt-1">
        <FilterBadge
          active={false}
          disabled={!canPersist || busy != null || !dirty}
          onClick={() => void persist(false)}
        >
          {busy === "save" ? "Saving…" : dirty ? "Save paths" : "Saved"}
        </FilterBadge>
        <FilterBadge
          active
          disabled={!canPersist || busy != null || draftPaths.length === 0}
          onClick={() => void persist(true)}
          title={
            needsApprove
              ? "Write paths and mark pathsStatus=discovered"
              : "Re-approve current path set"
          }
        >
          <Check className="size-3" aria-hidden />
          {busy === "approve" ? "Approving…" : "Approve paths"}
        </FilterBadge>
      </div>

      {!canPersist ? (
        <p className="text-[0.625rem] text-amber-700 dark:text-amber-300">
          Persistence is available when the web app runs in development
          (writes `top-typescript-docs.json`).
        </p>
      ) : null}
      {error ? (
        <p className="text-[0.625rem] text-red-600 dark:text-red-300">{error}</p>
      ) : null}
      {notice ? (
        <p className="text-[0.625rem] text-emerald-700 dark:text-emerald-300">
          {notice}
        </p>
      ) : null}
    </section>
  );
}
