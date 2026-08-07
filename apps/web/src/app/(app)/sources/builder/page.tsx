"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { BookOpen, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import {
  createEmptyDraft,
  createSampleDraft,
  deleteBuilderFamily,
  listBuilderFamilies,
  saveBuilderDraft,
  type SourceBuilderDraft,
} from "@/lib/source-builder-draft";
import { cn } from "@/lib/utils";

export default function SourceBuilderOverviewPage() {
  const router = useRouter();
  const [drafts, setDrafts] = useState<SourceBuilderDraft[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setDrafts(listBuilderFamilies());
    setReady(true);
  }, []);

  function refresh() {
    setDrafts(listBuilderFamilies());
  }

  function handleCreate(kind: "empty" | "sample") {
    const draft =
      kind === "sample" ? createSampleDraft() : createEmptyDraft("New source");
    saveBuilderDraft(draft);
    router.push(`/sources/builder/${draft.id}`);
  }

  function handleDelete(familyId: string) {
    deleteBuilderFamily(familyId);
    refresh();
  }

  return (
    <Container className="py-8 sm:py-10">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[0.62rem] font-semibold uppercase tracking-wide text-muted">
            Source builder
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-foreground">
            Build documentation sources
          </h1>
          <p className="mt-2 max-w-xl text-sm text-muted">
            Mirror a docs tree with categories and pages, edit pin content,
            version your docs, then index them into LedgeIndex.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            className="h-10 rounded-full px-4 text-sm"
            onClick={() => handleCreate("sample")}
          >
            Start from sample
          </Button>
          <Button
            className="h-10 rounded-full px-4 text-sm"
            onClick={() => handleCreate("empty")}
          >
            <Plus className="mr-1.5 size-4" />
            New source
          </Button>
        </div>
      </div>

      {!ready ? (
        <p className="text-sm text-muted">Loading drafts…</p>
      ) : drafts.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-surface-alt/40 px-6 py-14 text-center">
          <BookOpen className="mx-auto size-8 text-muted" />
          <h2 className="mt-3 text-base font-semibold text-foreground">
            No builder sources yet
          </h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted">
            Create a source to sketch categories, pages, and pin content before
            wiring ingest.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            <Button
              variant="secondary"
              className="h-10 rounded-full px-4 text-sm"
              onClick={() => handleCreate("sample")}
            >
              Start from sample
            </Button>
            <Button
              className="h-10 rounded-full px-4 text-sm"
              onClick={() => handleCreate("empty")}
            >
              New source
            </Button>
          </div>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {drafts.map((draft) => (
            <li key={draft.id}>
              <div
                className={cn(
                  "group flex h-full flex-col rounded-xl border border-border bg-card-solid p-4 shadow-card transition-colors hover:bg-surface-raised",
                )}
              >
                <Link
                  href={`/sources/builder/${draft.id}`}
                  className="min-w-0 flex-1"
                >
                  <h2 className="truncate text-base font-semibold text-foreground">
                    {draft.name}
                  </h2>
                  <p className="mt-1 line-clamp-2 text-sm text-muted">
                    {draft.description?.trim() ||
                      `${draft.categories.length} categories · ${draft.pages.length} pages · ${draft.versionLabel}`}
                  </p>
                  <p className="mt-3 text-[11px] text-muted">
                    Updated {new Date(draft.updatedAt).toLocaleString()}
                    {draft.linkedSourceId ? " · indexed" : ""}
                  </p>
                </Link>
                <div className="mt-3 flex justify-end border-t border-border/60 pt-3">
                  <button
                    type="button"
                    onClick={() => handleDelete(draft.familyId)}
                    className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-muted transition-colors hover:bg-background hover:text-foreground"
                  >
                    <Trash2 className="size-3.5" />
                    Delete
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Container>
  );
}
