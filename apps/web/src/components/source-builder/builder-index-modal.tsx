"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Database, Loader2, X } from "lucide-react";
import { IngestPipelineFlow } from "@/components/sources/ingest-pipeline-flow";
import { useIndexedFlash } from "@/contexts/indexed-flash-context";
import {
  getSource,
  indexPreviewPages,
  type IngestPipelineNode,
} from "@/lib/ledgeindex-api";
import {
  defaultBuilderMetadata,
  ensureBuilderLinkedSource,
} from "@/lib/builder-ensure-source";
import { syncApiBaseForHosting } from "@/lib/desktop-api-routing";
import { useHostingCapabilities } from "@/lib/use-hosting-capabilities";
import { SourceHostingToggle } from "@/components/sources/source-hosting-toggle";
import type { SourceHosting } from "@ledgeindex/client";
import {
  buildIndexPagesForDraft,
  groupIndexPagesForDraft,
  listBuilderVersions,
  saveBuilderDraft,
  saveBuilderDraftAsNewVersion,
  type BuilderIndexPage,
  type SourceBuilderDraft,
} from "@/lib/source-builder-draft";
import { cn } from "@/lib/utils";

type Props = {
  open: boolean;
  draft: SourceBuilderDraft;
  onClose: () => void;
  onIndexed: (next: {
    linkedSourceId: string;
    chunkCount: number;
    pageCount: number;
    draft: SourceBuilderDraft;
  }) => void;
};

type IndexPhase = "idle" | "prepare" | "index" | "store" | "done" | "error";
type VersionMode = "replace" | "new";

async function ensureLinkedSource(
  draft: SourceBuilderDraft,
  hosting?: "local" | "cloud",
): Promise<string> {
  const { sourceId } = await ensureBuilderLinkedSource(
    draft,
    draft.sourceMetadata
      ? {
          ...draft.sourceMetadata,
          version: draft.versionLabel,
          versionSource: "user",
          detectedSignals: draft.sourceMetadata.detectedSignals?.length
            ? draft.sourceMetadata.detectedSignals
            : ["source-builder"],
        }
      : defaultBuilderMetadata(draft.versionLabel),
    { hosting },
  );
  return sourceId;
}

function suggestNextVersionLabel(draft: SourceBuilderDraft): string {
  const siblings = listBuilderVersions(draft.familyId);
  const nextNumber =
    Math.max(0, ...siblings.map((entry) => entry.versionNumber)) + 1;
  return `v${nextNumber}`;
}

function builderIndexPipeline(
  phase: IndexPhase,
  meta?: { pageCount?: number; chunkCount?: number; error?: string | null },
): IngestPipelineNode[] {
  const pageCount = meta?.pageCount ?? 0;
  const chunkCount = meta?.chunkCount;
  const err = meta?.error;

  const statusFor = (
    step: "crawl" | "extract" | "embed" | "store",
  ): IngestPipelineNode["status"] => {
    if (phase === "idle") return "pending";
    if (phase === "done") return "done";
    if (phase === "error") {
      if (step === "crawl" || step === "extract") return "done";
      if (step === "embed") return "error";
      return "pending";
    }
    if (step === "crawl") return "done";
    if (step === "extract") {
      return phase === "prepare" ? "running" : "done";
    }
    if (step === "embed") {
      if (phase === "prepare") return "pending";
      if (phase === "index") return "running";
      return "done";
    }
    if (phase === "store") return "running";
    return "pending";
  };

  return [
    {
      id: "crawl",
      label: "Source",
      status: statusFor("crawl"),
      detail:
        phase === "idle"
          ? "Builder pages"
          : `${pageCount || "—"} pages ready`,
    },
    {
      id: "extract",
      label: "Preparing",
      status: statusFor("extract"),
      detail:
        statusFor("extract") === "running"
          ? "Linking source…"
          : statusFor("extract") === "done"
            ? "Pages packed"
            : "Waiting",
    },
    {
      id: "embed",
      label: "Indexing",
      status: phase === "error" ? "error" : statusFor("embed"),
      detail:
        phase === "error"
          ? err || "Indexing failed"
          : statusFor("embed") === "running"
            ? "Chunking + embedding…"
            : statusFor("embed") === "done"
              ? chunkCount != null
                ? `${chunkCount} chunks`
                : "Indexed"
              : "Waiting",
    },
    {
      id: "store",
      label: "Storing",
      status: phase === "error" ? "pending" : statusFor("store"),
      detail:
        statusFor("store") === "running"
          ? "Writing to index…"
          : statusFor("store") === "done"
            ? chunkCount != null
              ? `${chunkCount} chunks stored`
              : "Stored"
            : "Waiting",
    },
  ];
}

export function BuilderIndexModal({
  open,
  draft,
  onClose,
  onIndexed,
}: Props) {
  const { triggerIndexedFlash } = useIndexedFlash();
  const [mounted, setMounted] = useState(false);
  const pages = useMemo(() => buildIndexPagesForDraft(draft), [draft]);
  const groups = useMemo(
    () => groupIndexPagesForDraft(draft, pages),
    [draft, pages],
  );
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<IndexPhase>("idle");
  const [result, setResult] = useState<{
    chunkCount: number;
    pageCount: number;
    sourceId: string;
  } | null>(null);
  const [existingIndexed, setExistingIndexed] = useState<{
    chunkCount: number;
    pageCount: number;
    versionLabel: string;
  } | null>(null);
  const [checkingIndexed, setCheckingIndexed] = useState(false);
  const [versionMode, setVersionMode] = useState<VersionMode>("replace");
  const [versionLabel, setVersionLabel] = useState(draft.versionLabel);
  const [suggestedNewLabel, setSuggestedNewLabel] = useState("v2");
  const hostingCaps = useHostingCapabilities();
  const [hosting, setHosting] = useState<SourceHosting>(
    draft.preferredHosting ?? "local",
  );

  useEffect(() => {
    setMounted(true);
  }, []);

  // Reset only when the modal opens — not when draft updates after a successful index.
  useEffect(() => {
    if (!open) return;

    const pageList = buildIndexPagesForDraft(draft);
    setSelectedIds(new Set(pageList.map((page) => page.pageId)));
    setError(null);
    setResult(null);
    setBusy(false);
    setPhase("idle");
    setVersionMode("replace");
    setVersionLabel(draft.versionLabel);
    setSuggestedNewLabel(suggestNextVersionLabel(draft));
    setExistingIndexed(null);
    setHosting(draft.preferredHosting ?? "local");

    let cancelled = false;
    if (!draft.linkedSourceId) {
      setCheckingIndexed(false);
      return;
    }

    setCheckingIndexed(true);
    void (async () => {
      try {
        const { source } = await getSource(draft.linkedSourceId!);
        const chunkCount = source.indexStats?.chunkCount ?? 0;
        if (cancelled) return;
        if (chunkCount > 0) {
          setExistingIndexed({
            chunkCount,
            pageCount: source.indexStats?.pageCount ?? 0,
            versionLabel: source.versionLabel ?? draft.versionLabel,
          });
          setVersionLabel(source.versionLabel ?? draft.versionLabel);
        }
      } catch {
        if (!cancelled) setExistingIndexed(null);
      } finally {
        if (!cancelled) setCheckingIndexed(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only on open
  }, [open]);

  useEffect(() => {
    if (!hostingCaps.ready) return;
    if (!hostingCaps.localAvailable) {
      setHosting("cloud");
      return;
    }
    if (!draft.preferredHosting) {
      setHosting(hostingCaps.default);
    }
  }, [
    hostingCaps.ready,
    hostingCaps.localAvailable,
    hostingCaps.default,
    draft.preferredHosting,
  ]);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, busy, onClose]);

  if (!open || !mounted) return null;

  const selectedPages = pages.filter((page) => selectedIds.has(page.pageId));
  const pipeline = builderIndexPipeline(phase, {
    pageCount: result?.pageCount ?? selectedPages.length,
    chunkCount: result?.chunkCount,
    error,
  });
  const activeStepId = pipeline.find((node) => node.status === "running")?.id;
  const showVersionChoice =
    Boolean(existingIndexed) && phase !== "done" && !result;

  function togglePage(pageId: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(pageId)) next.delete(pageId);
      else next.add(pageId);
      return next;
    });
  }

  function toggleMany(pageIds: string[], select: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current);
      for (const id of pageIds) {
        if (select) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  function selectVersionMode(mode: VersionMode) {
    setVersionMode(mode);
    if (mode === "new") {
      setVersionLabel(suggestedNewLabel);
    } else {
      setVersionLabel(
        existingIndexed?.versionLabel ?? draft.versionLabel,
      );
    }
  }

  async function handleIndex() {
    if (selectedPages.length === 0) {
      setError("Select at least one page to index.");
      return;
    }
    if (checkingIndexed) return;

    setBusy(true);
    setError(null);
    setResult(null);
    setPhase("prepare");
    try {
      let workingDraft = draft;

      if (existingIndexed && versionMode === "new") {
        const created = saveBuilderDraftAsNewVersion(draft);
        workingDraft = saveBuilderDraft({
          ...created,
          versionLabel: versionLabel.trim() || created.versionLabel,
        });
      } else if (
        existingIndexed &&
        versionMode === "replace" &&
        versionLabel.trim() &&
        versionLabel.trim() !== draft.versionLabel
      ) {
        workingDraft = saveBuilderDraft({
          ...draft,
          versionLabel: versionLabel.trim(),
        });
      }

      const effectiveHosting: SourceHosting = hostingCaps.localAvailable
        ? hosting
        : "cloud";
      syncApiBaseForHosting({ scope: "personal", hosting: effectiveHosting });

      workingDraft = saveBuilderDraft({
        ...workingDraft,
        preferredHosting: effectiveHosting,
      });

      const sourceId = await ensureLinkedSource(
        workingDraft,
        effectiveHosting,
      );
      setPhase("index");
      const indexed = await indexPreviewPages(
        sourceId,
        selectedPages.map((page) => ({
          url: page.url,
          title: page.title,
          markdown: page.markdown,
        })),
      );
      setPhase("store");
      await new Promise((resolve) => window.setTimeout(resolve, 280));
      const nextDraft: SourceBuilderDraft = {
        ...workingDraft,
        linkedSourceId: sourceId,
        preferredHosting: effectiveHosting,
      };
      setResult({
        chunkCount: indexed.chunkCount,
        pageCount: indexed.pageCount,
        sourceId,
      });
      setPhase("done");
      onIndexed({
        linkedSourceId: sourceId,
        chunkCount: indexed.chunkCount,
        pageCount: indexed.pageCount,
        draft: nextDraft,
      });
      triggerIndexedFlash(sourceId);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Indexing failed";
      setError(message);
      setPhase("error");
    } finally {
      setBusy(false);
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center bg-black/45 p-4"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="builder-index-title"
        className="flex max-h-[min(85vh,40rem)] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border bg-card-solid shadow-card"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <p className="font-mono text-[0.58rem] font-semibold tracking-[0.14em] text-muted uppercase">
              Index review
            </p>
            <h2
              id="builder-index-title"
              className="text-base font-semibold text-foreground"
            >
              Index builder pages
            </h2>
            <p className="mt-0.5 text-xs text-muted">
              {draft.name} · {draft.versionLabel} · {pages.length} pages ·{" "}
              {groups.length} categories
            </p>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="inline-flex size-8 items-center justify-center rounded-lg border border-border text-muted hover:bg-surface-raised hover:text-foreground disabled:opacity-50"
            aria-label="Close index review"
          >
            <X className="size-4" />
          </button>
        </header>

        {phase === "done" && result ? (
          <div className="flex shrink-0 items-start gap-3 border-b border-foreground/10 bg-surface-raised/80 px-4 py-3">
            <span className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full border border-foreground/15 bg-foreground text-background">
              <Check className="size-3.5" aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground">
                Index saved · ready to query
              </p>
              <p className="mt-0.5 text-xs text-muted">
                {result.pageCount} pages · {result.chunkCount} chunks stored
                in this source.
              </p>
            </div>
          </div>
        ) : null}

        {showVersionChoice ? (
          <div className="shrink-0 space-y-3 border-b border-border px-4 py-3">
            <div>
              <p className="text-sm font-medium text-foreground">
                This version is already indexed
              </p>
              <p className="mt-0.5 text-xs text-muted">
                {existingIndexed!.pageCount} pages ·{" "}
                {existingIndexed!.chunkCount} chunks
                {existingIndexed!.versionLabel
                  ? ` · ${existingIndexed!.versionLabel}`
                  : ""}
                . Overwrite it, or index as a new version.
              </p>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => selectVersionMode("replace")}
                className={cn(
                  "rounded-lg border px-3 py-2.5 text-left transition-colors",
                  versionMode === "replace"
                    ? "border-foreground/25 bg-surface-raised"
                    : "border-border hover:bg-surface-raised/60",
                )}
              >
                <span className="block text-sm font-medium text-foreground">
                  Overwrite this version
                </span>
                <span className="mt-0.5 block text-xs text-muted">
                  Replace the existing index for{" "}
                  {existingIndexed!.versionLabel || draft.versionLabel}.
                </span>
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => selectVersionMode("new")}
                className={cn(
                  "rounded-lg border px-3 py-2.5 text-left transition-colors",
                  versionMode === "new"
                    ? "border-foreground/25 bg-surface-raised"
                    : "border-border hover:bg-surface-raised/60",
                )}
              >
                <span className="block text-sm font-medium text-foreground">
                  Create new version
                </span>
                <span className="mt-0.5 block text-xs text-muted">
                  Keep the current index and save a new snapshot.
                </span>
              </button>
            </div>

            <label className="block">
              <span className="mb-1 block font-mono text-[0.5625rem] font-semibold tracking-[0.1em] text-muted uppercase">
                Version label
              </span>
              <input
                value={versionLabel}
                disabled={busy}
                onChange={(event) => setVersionLabel(event.target.value)}
                placeholder={
                  versionMode === "new"
                    ? suggestedNewLabel
                    : existingIndexed!.versionLabel
                }
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-foreground/15 disabled:opacity-50"
              />
            </label>
          </div>
        ) : null}

        {hostingCaps.localAvailable && phase !== "done" && !result ? (
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2">
            <div className="min-w-0">
              <p className="text-xs font-medium text-foreground">
                Index hosting
              </p>
              <p className="text-[0.6875rem] text-muted">
                Local stays on this machine. Cloud is account-bound on our DB
                (not public).
              </p>
            </div>
            <SourceHostingToggle
              value={hosting}
              onChange={setHosting}
              disabled={busy || Boolean(existingIndexed && draft.linkedSourceId)}
              size="compact"
            />
          </div>
        ) : null}

        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2">
          <span className="font-mono text-[0.625rem] text-muted">
            {selectedPages.length} selected
            {selectedPages.length > 0
              ? ` · ${selectedPages.reduce((sum, page) => sum + page.charCount, 0).toLocaleString()} chars`
              : ""}
          </span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={busy || phase === "done"}
              onClick={() =>
                setSelectedIds(new Set(pages.map((page) => page.pageId)))
              }
              className="rounded-md border border-border px-2 py-0.5 font-mono text-[0.5rem] font-semibold tracking-[0.08em] text-muted uppercase hover:text-foreground disabled:opacity-50"
            >
              Select all
            </button>
            <button
              type="button"
              disabled={busy || phase === "done"}
              onClick={() => setSelectedIds(new Set())}
              className="rounded-md border border-border px-2 py-0.5 font-mono text-[0.5rem] font-semibold tracking-[0.08em] text-muted uppercase hover:text-foreground disabled:opacity-50"
            >
              Clear
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-3">
          {groups.map((group) => {
            const groupPageIds = group.sections.flatMap((section) =>
              section.pages.map((page) => page.pageId),
            );
            const selectedInGroup = groupPageIds.filter((id) =>
              selectedIds.has(id),
            ).length;
            const allSelected =
              groupPageIds.length > 0 &&
              selectedInGroup === groupPageIds.length;

            return (
              <section
                key={group.categoryId}
                className="overflow-hidden rounded-xl border border-border bg-background"
              >
                <div className="flex items-center justify-between gap-2 border-b border-border bg-surface-raised/70 px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-foreground">
                      {group.categoryTitle}
                    </p>
                    <p className="font-mono text-[0.5625rem] text-muted">
                      {groupPageIds.length} page
                      {groupPageIds.length === 1 ? "" : "s"}
                      {selectedInGroup > 0
                        ? ` · ${selectedInGroup} selected`
                        : ""}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={
                      busy || phase === "done" || groupPageIds.length === 0
                    }
                    onClick={() => toggleMany(groupPageIds, !allSelected)}
                    className="shrink-0 rounded-md border border-border px-2 py-0.5 font-mono text-[0.5rem] font-semibold tracking-[0.08em] text-muted uppercase hover:text-foreground disabled:opacity-50"
                  >
                    {allSelected ? "Deselect" : "Select"}
                  </button>
                </div>

                <div className="space-y-3 p-2.5">
                  {group.sections.map((section) => {
                    const sectionIds = section.pages.map((page) => page.pageId);
                    const sectionSelected = sectionIds.filter((id) =>
                      selectedIds.has(id),
                    ).length;
                    const sectionAll =
                      sectionIds.length > 0 &&
                      sectionSelected === sectionIds.length;

                    return (
                      <div key={section.subcategoryId ?? "root"}>
                        {section.subcategoryTitle ? (
                          <div className="mb-1.5 flex items-center justify-between gap-2 px-1">
                            <p className="font-mono text-[0.5625rem] font-semibold tracking-[0.1em] text-muted uppercase">
                              {section.subcategoryTitle}
                            </p>
                            <button
                              type="button"
                              disabled={busy || phase === "done"}
                              onClick={() =>
                                toggleMany(sectionIds, !sectionAll)
                              }
                              className="font-mono text-[0.5rem] font-semibold tracking-[0.08em] text-muted uppercase hover:text-foreground disabled:opacity-50"
                            >
                              {sectionAll ? "Deselect" : "Select"}
                            </button>
                          </div>
                        ) : group.sections.length > 1 ? (
                          <p className="mb-1.5 px-1 font-mono text-[0.5625rem] font-semibold tracking-[0.1em] text-muted uppercase">
                            Pages
                          </p>
                        ) : null}

                        <ul className="list-none space-y-1">
                          {section.pages.map((page) => (
                            <IndexPageRow
                              key={page.pageId}
                              page={page}
                              selected={selectedIds.has(page.pageId)}
                              disabled={busy || phase === "done"}
                              onToggle={() => togglePage(page.pageId)}
                            />
                          ))}
                        </ul>
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>

        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-2.5 sm:px-4">
          <div className="min-w-0 flex-1">
            {error ? (
              <p className="px-1 text-xs text-red-600 dark:text-red-300">
                {error}
              </p>
            ) : (
              <IngestPipelineFlow
                pipeline={pipeline}
                layout="horizontal"
                variant="banner"
                bannerSize="strip"
                stripAlign="start"
                className="min-h-0 border-0 bg-transparent py-0 shadow-none"
                animate={busy}
                activeStepId={activeStepId}
              />
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={onClose}
              className="inline-flex h-8 items-center rounded-lg border border-border px-3 text-xs font-medium text-muted hover:text-foreground disabled:opacity-50"
            >
              {result ? "Done" : "Cancel"}
            </button>
            {result ? null : (
              <button
                type="button"
                disabled={
                  busy ||
                  checkingIndexed ||
                  selectedPages.length === 0
                }
                onClick={() => void handleIndex()}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-foreground px-3 text-xs font-medium text-background hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busy ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin" />
                    Indexing…
                  </>
                ) : (
                  <>
                    <Database className="size-3.5" />
                    {existingIndexed
                      ? versionMode === "new"
                        ? "Index new version"
                        : "Overwrite & save"
                      : "Index & save"}
                  </>
                )}
              </button>
            )}
          </div>
        </footer>
      </section>
    </div>,
    document.body,
  );
}

function IndexPageRow({
  page,
  selected,
  disabled,
  onToggle,
}: {
  page: BuilderIndexPage;
  selected: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <li>
      <label
        className={cn(
          "flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 transition-colors",
          selected
            ? "border-foreground/15 bg-surface-raised"
            : "border-border/70 bg-card-solid hover:bg-surface-raised/60",
          disabled && "cursor-not-allowed opacity-60",
        )}
      >
        <span
          className={cn(
            "inline-flex size-4 shrink-0 items-center justify-center rounded border transition-colors",
            selected
              ? "border-foreground bg-foreground text-background"
              : "border-border bg-card-solid text-transparent",
          )}
          aria-hidden
        >
          <Check className="size-2.5 stroke-[3]" />
        </span>
        <input
          type="checkbox"
          checked={selected}
          disabled={disabled}
          onChange={onToggle}
          className="sr-only"
        />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
          {page.title}
        </span>
        <span className="shrink-0 font-mono text-[0.625rem] text-muted">
          {page.charCount.toLocaleString()} chars
        </span>
      </label>
    </li>
  );
}
