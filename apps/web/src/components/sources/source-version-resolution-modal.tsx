"use client";

import { useEffect, useMemo, useState } from "react";
import type { SourceDuplicateMatch } from "@/lib/ledgeindex-api";

export type VersionResolutionChoice = {
  mode: "new" | "replace";
  replaceSourceId?: string;
  versionLabel: string;
};

export function SourceVersionResolutionModal({
  open,
  duplicate,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  duplicate: SourceDuplicateMatch | null;
  onCancel: () => void;
  onConfirm: (choice: VersionResolutionChoice) => void;
}) {
  const [mode, setMode] = useState<"new" | "replace">("new");
  const [versionLabel, setVersionLabel] = useState("");
  const [replaceSourceId, setReplaceSourceId] = useState("");

  const versions = useMemo(() => {
    if (!duplicate) return [];
    if (duplicate.versions.length > 0) return duplicate.versions;
    return [
      {
        id: duplicate.existing.id,
        versionNumber: duplicate.existing.versionNumber,
        versionLabel: duplicate.existing.versionLabel,
        indexedAt: duplicate.existing.indexedAt,
        chunkCount: duplicate.existing.chunkCount,
        pageCount: duplicate.existing.pageCount,
      },
    ];
  }, [duplicate]);

  const selectedReplaceVersion = useMemo(
    () => versions.find((version) => version.id === replaceSourceId) ?? versions[0] ?? null,
    [replaceSourceId, versions],
  );

  useEffect(() => {
    if (!duplicate) return;
    setMode("new");
    setVersionLabel(duplicate.suggestedVersionLabel);
    setReplaceSourceId(duplicate.existing.id);
  }, [duplicate]);

  useEffect(() => {
    if (mode !== "replace" || !selectedReplaceVersion) return;
    setVersionLabel(selectedReplaceVersion.versionLabel);
  }, [mode, selectedReplaceVersion?.id, selectedReplaceVersion?.versionLabel]);

  if (!open || !duplicate) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="version-resolution-title"
        className="w-full max-w-lg rounded-xl border border-border bg-card-solid p-5 shadow-card"
      >
        <h2 id="version-resolution-title" className="text-base font-semibold text-foreground">
          This documentation is already indexed
        </h2>
        <p className="mt-2 text-sm text-muted">
          We found an existing set for{" "}
          <span className="font-mono text-foreground/90">{duplicate.canonicalUrl}</span>.
          Choose whether to replace a version or add a new one.
        </p>

        <div className="mt-4 space-y-2">
          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3">
            <input
              type="radio"
              name="version-mode"
              checked={mode === "replace"}
              onChange={() => setMode("replace")}
              className="mt-1"
            />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-foreground">
                Replace existing version
              </span>
              <span className="mt-0.5 block text-xs text-muted">
                Overwrite a specific version with the new crawl.
              </span>
            </span>
          </label>

          {mode === "replace" ? (
            <label className="ml-7 block">
              <span className="mb-1 block font-mono text-[0.625rem] font-semibold tracking-[0.12em] text-muted uppercase">
                Version to replace
              </span>
              <select
                value={replaceSourceId}
                onChange={(event) => setReplaceSourceId(event.target.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
              >
                {versions.map((version) => (
                  <option key={version.id} value={version.id}>
                    {version.versionLabel} · {version.chunkCount} chunks
                    {version.pageCount > 0 ? ` · ${version.pageCount} pages` : ""}
                  </option>
                ))}
              </select>
              {selectedReplaceVersion ? (
                <span className="mt-1 block text-xs text-muted">
                  This will replace {selectedReplaceVersion.versionLabel} (
                  {selectedReplaceVersion.chunkCount} chunks).
                </span>
              ) : null}
            </label>
          ) : null}

          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3">
            <input
              type="radio"
              name="version-mode"
              checked={mode === "new"}
              onChange={() => {
                setMode("new");
                setVersionLabel(duplicate.suggestedVersionLabel);
              }}
              className="mt-1"
            />
            <span>
              <span className="block text-sm font-medium text-foreground">
                Add new version
              </span>
              <span className="mt-0.5 block text-xs text-muted">
                Keep existing versions and index this crawl as a separate snapshot.
              </span>
            </span>
          </label>
        </div>

        <label className="mt-4 block">
          <span className="mb-1 block font-mono text-[0.625rem] font-semibold tracking-[0.12em] text-muted uppercase">
            Version label
          </span>
          <input
            value={versionLabel}
            onChange={(event) => setVersionLabel(event.target.value)}
            placeholder={
              mode === "replace"
                ? selectedReplaceVersion?.versionLabel ?? duplicate.suggestedVersionLabel
                : duplicate.suggestedVersionLabel
            }
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
          />
          <span className="mt-1 block text-xs text-muted">
            {mode === "replace"
              ? `Label for the replaced version. Current: ${selectedReplaceVersion?.versionLabel ?? "—"}`
              : `Examples: nextjs 16, v3, 2026-03. Suggested: ${duplicate.suggestedVersionLabel}`}
          </span>
        </label>

        {versions.length > 1 ? (
          <div className="mt-4 rounded-lg border border-border/70 bg-surface-alt/50 p-3">
            <p className="font-mono text-[0.625rem] font-semibold tracking-[0.12em] text-muted uppercase">
              All versions
            </p>
            <ul className="mt-2 space-y-1 text-xs text-muted">
              {versions.map((version) => (
                <li key={version.id}>
                  {version.versionLabel} · {version.chunkCount} chunks
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:bg-surface-raised"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() =>
              onConfirm({
                mode,
                replaceSourceId:
                  mode === "replace"
                    ? replaceSourceId || duplicate.existing.id
                    : undefined,
                versionLabel:
                  versionLabel.trim() ||
                  (mode === "replace"
                    ? selectedReplaceVersion?.versionLabel ?? duplicate.suggestedVersionLabel
                    : duplicate.suggestedVersionLabel),
              })
            }
            className="rounded-md bg-foreground px-3 py-1.5 text-sm font-medium text-background hover:opacity-90"
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}
