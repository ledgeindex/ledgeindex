"use client";

import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { BuilderIndexModal } from "@/components/source-builder/builder-index-modal";
import { SourceBuilderShell } from "@/components/source-builder/source-builder-shell";
import {
  DocsIdentityDialog,
  docsIdentitySummaryText,
} from "@/components/sources/docs-identity-dialog";
import { Container } from "@/components/ui/container";
import { useSourceBuilderToolbar } from "@/contexts/source-builder-toolbar-context";
import {
  defaultBuilderMetadata,
  ensureBuilderLinkedSource,
} from "@/lib/builder-ensure-source";
import {
  buildIndexPagesForDraft,
  builderStartUrl,
  getBuilderDraft,
  listBuilderVersions,
  saveBuilderDraft,
  saveBuilderDraftAsNewVersion,
  type SourceBuilderDraft,
} from "@/lib/source-builder-draft";
import type { SourceMetadata } from "@/lib/source-metadata";
import { cn } from "@/lib/utils";

function metadataForDraft(draft: SourceBuilderDraft): SourceMetadata {
  if (draft.sourceMetadata) {
    return {
      ...draft.sourceMetadata,
      version: draft.sourceMetadata.version ?? draft.versionLabel,
      versionSource: draft.sourceMetadata.versionSource ?? "user",
      detectedSignals: draft.sourceMetadata.detectedSignals?.length
        ? draft.sourceMetadata.detectedSignals
        : ["source-builder"],
    };
  }
  return defaultBuilderMetadata(draft.versionLabel);
}

export default function SourceBuilderDetailPage() {
  const params = useParams<{ draftId: string }>();
  const router = useRouter();
  const { setHeader } = useSourceBuilderToolbar();
  const draftId = params.draftId;
  const [draft, setDraft] = useState<SourceBuilderDraft | null>(null);
  const [ready, setReady] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [indexOpen, setIndexOpen] = useState(false);
  const [pendingIndexNavId, setPendingIndexNavId] = useState<string | null>(
    null,
  );
  const [justSaved, setJustSaved] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [aboutBusy, setAboutBusy] = useState(false);
  const [aboutError, setAboutError] = useState<string | null>(null);

  useEffect(() => {
    const loaded = getBuilderDraft(draftId);
    setDraft(loaded);
    setDirty(false);
    setAboutOpen(false);
    setReady(true);
  }, [draftId]);

  const versions = useMemo(
    () => (draft ? listBuilderVersions(draft.familyId) : []),
    [draft],
  );

  const handleAboutToggle = useCallback(async () => {
    if (!draft) return;
    if (aboutOpen) {
      setAboutOpen(false);
      return;
    }

    setAboutError(null);
    setAboutBusy(true);
    try {
      const current = dirty
        ? (() => {
            const saved = saveBuilderDraft(draft);
            setDraft(saved);
            setDirty(false);
            setJustSaved(true);
            window.setTimeout(() => setJustSaved(false), 1600);
            return saved;
          })()
        : draft;
      const { sourceId, sourceMetadata } = await ensureBuilderLinkedSource(
        current,
        metadataForDraft(current),
      );
      const next = saveBuilderDraft({
        ...current,
        linkedSourceId: sourceId,
        sourceMetadata,
      });
      setDraft(next);
      setDirty(false);
      setAboutOpen(true);
    } catch (error) {
      setAboutError(
        error instanceof Error
          ? error.message
          : "Could not prepare source for About",
      );
    } finally {
      setAboutBusy(false);
    }
  }, [draft, dirty, aboutOpen]);

  useEffect(() => {
    if (!draft) {
      setHeader(null);
      return;
    }

    setHeader({
      name: draft.name,
      dirty,
      justSaved,
      draftId: draft.id,
      versions,
      aboutOpen,
      aboutBusy,
      onRename: (name: string) => {
        setDraft((current) => {
          if (!current) return current;
          setDirty(true);
          return { ...current, name };
        });
      },
      onVersionChange: (versionId: string) => {
        if (versionId === draft.id) return;
        if (dirty) {
          const ok = window.confirm(
            "You have unsaved changes. Switch version and discard them?",
          );
          if (!ok) return;
        }
        router.push(`/sources/builder/${versionId}`);
      },
      onSaveUpdate: () => {
        const saved = saveBuilderDraft(draft);
        setDraft(saved);
        setDirty(false);
        setJustSaved(true);
        window.setTimeout(() => setJustSaved(false), 1600);
      },
      onSaveAsNew: () => {
        const saved = saveBuilderDraftAsNewVersion(draft);
        setDraft(saved);
        setDirty(false);
        setJustSaved(true);
        window.setTimeout(() => setJustSaved(false), 1600);
        if (saved.id !== draftId) {
          router.replace(`/sources/builder/${saved.id}`);
        }
      },
      onIndex: () => {
        if (dirty) {
          const saved = saveBuilderDraft(draft);
          setDraft(saved);
          setDirty(false);
        }
        setIndexOpen(true);
      },
      onAboutToggle: () => {
        void handleAboutToggle();
      },
    });

    return () => setHeader(null);
  }, [
    draft,
    dirty,
    justSaved,
    versions,
    aboutOpen,
    aboutBusy,
    handleAboutToggle,
    setHeader,
    router,
    draftId,
  ]);

  function handleChange(next: SourceBuilderDraft) {
    setDraft(next);
    setDirty(true);
  }

  if (!ready) {
    return (
      <Container className="py-6 sm:py-8">
        <p className="text-sm text-muted">Loading source…</p>
      </Container>
    );
  }

  if (!draft) {
    return (
      <Container className="py-6 sm:py-8">
        <p className="text-sm text-muted">Draft not found.</p>
        <button
          type="button"
          className="mt-3 text-sm text-foreground underline"
          onClick={() => router.push("/sources/builder")}
        >
          Back to overview
        </button>
      </Container>
    );
  }

  return (
    <Container
      className={cn(
        "flex min-h-0 flex-1 flex-col py-4 sm:py-5",
        aboutOpen && "max-w-none",
      )}
    >
      {aboutError ? (
        <p className="mb-3 text-xs text-red-600 dark:text-red-300">
          {aboutError}
        </p>
      ) : null}

      <div
        className={cn(
          "flex min-h-0 flex-1 flex-col",
          aboutOpen &&
            "overflow-hidden rounded-xl border border-border lg:flex-row",
        )}
      >
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <SourceBuilderShell
            draft={draft}
            onChange={handleChange}
            className={cn(
              "min-h-[calc(100vh-7rem)]",
              aboutOpen && "rounded-none border-0 shadow-none",
            )}
          />
        </div>

        {aboutOpen && draft.linkedSourceId ? (
          <DocsIdentityDialog
            variant="panel"
            sourceId={draft.linkedSourceId}
            startUrls={[builderStartUrl(draft)]}
            open={aboutOpen}
            onOpenChange={setAboutOpen}
            seedPages={buildIndexPagesForDraft(draft).map((page) => ({
              url: page.url,
              title: page.title,
              markdown: page.markdown,
            }))}
            onSaved={(identity) => {
              const current = draft;
              const nextMeta: SourceMetadata = {
                ...metadataForDraft(current),
                docsIdentity: identity ?? undefined,
              };
              const summary = docsIdentitySummaryText(identity);
              const next = saveBuilderDraft({
                ...current,
                description: summary || current.description,
                sourceMetadata: nextMeta,
              });
              setDraft(next);
              setDirty(false);
            }}
          />
        ) : null}
      </div>

      <BuilderIndexModal
        open={indexOpen}
        draft={draft}
        onClose={() => {
          setIndexOpen(false);
          if (pendingIndexNavId && pendingIndexNavId !== draftId) {
            const nextId = pendingIndexNavId;
            setPendingIndexNavId(null);
            router.replace(`/sources/builder/${nextId}`);
          } else {
            setPendingIndexNavId(null);
          }
        }}
        onIndexed={({ linkedSourceId, draft: indexedDraft }) => {
          const next = saveBuilderDraft({
            ...indexedDraft,
            linkedSourceId,
            sourceMetadata: metadataForDraft({
              ...indexedDraft,
              linkedSourceId,
            }),
          });
          setDraft(next);
          setDirty(false);
          if (next.id !== draftId) {
            setPendingIndexNavId(next.id);
          }
        }}
      />
    </Container>
  );
}
