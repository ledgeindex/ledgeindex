"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { CachedRemoteImage } from "@/components/sources/cached-remote-image";
import { SourceActionsMenu } from "@/components/sources/source-actions-menu";
import { SourceCategoryBadges } from "@/components/sources/source-category-filter";
import { SourceSlugEditor } from "@/components/sources/source-slug-editor";
import { SourceNameEditor } from "@/components/sources/source-name-editor";
import {
  resolveSourceVersion,
  SourceVersionSelect,
} from "@/components/sources/source-version-select";
import { formatUrlLabel } from "@/components/sources/source-display";
import { cn } from "@/lib/utils";
import type { SourceSummary } from "@/lib/ledgeindex-api";

function SourceFavicon({
  source,
  className,
}: {
  source: SourceSummary;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const initials = source.name.slice(0, 2).toUpperCase();
  const showFavicon = Boolean(source.faviconUrl) && !failed;

  if (showFavicon) {
    return (
      <CachedRemoteImage
        sourceId={source.id}
        url={source.faviconUrl!}
        className={cn(
          "shrink-0 rounded-md border border-border bg-background object-contain p-0.5 shadow-card",
          className,
        )}
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center rounded-md border border-border bg-surface-raised font-mono text-[0.625rem] font-semibold text-foreground/50",
        className,
      )}
      aria-hidden
    >
      {initials}
    </div>
  );
}

export function SourceListRow({
  source,
  highlighted = false,
  onDelete,
  deleting = false,
  canEditSlug = false,
  canEditName = false,
  canEditCategories = false,
  showActionsMenu = true,
  onSlugUpdated,
  onNameUpdated,
  onCategoriesUpdated,
  onRefreshApplied,
}: {
  source: SourceSummary;
  highlighted?: boolean;
  onDelete?: (sourceId: string) => void | Promise<void>;
  deleting?: boolean;
  canEditSlug?: boolean;
  canEditName?: boolean;
  canEditCategories?: boolean;
  showActionsMenu?: boolean;
  onSlugUpdated?: (sourceId: string, slug: string) => void;
  onNameUpdated?: (sourceId: string, name: string) => void;
  onCategoriesUpdated?: (sourceId: string, categories: string[]) => void;
  onRefreshApplied?: () => void;
}) {
  const [selectedVersionId, setSelectedVersionId] = useState(source.id);
  const activeSource = useMemo(
    () => resolveSourceVersion(source, selectedVersionId),
    [source, selectedVersionId],
  );
  const label = formatUrlLabel(activeSource.startUrl || activeSource.name);

  function handleDelete() {
    if (!onDelete || deleting) return;
    const deleteLabel = source.name || source.startUrl || "this set";
    const confirmed = window.confirm(
      `Delete "${deleteLabel}"?\n\nThis removes the set, its vectors, and catalog. This cannot be undone.`,
    );
    if (!confirmed) return;
    void onDelete(activeSource.id);
  }

  return (
    <article
      title={`${activeSource.pageCount} pages · ${activeSource.chunkCount} chunks`}
      className={cn(
        "flex items-center gap-3 rounded-xl border bg-card-solid px-3 py-2.5 shadow-card transition-[border-color,box-shadow] duration-700 sm:gap-4 sm:px-4",
        highlighted
          ? "border-emerald-500/40 ring-1 ring-emerald-500/20"
          : "border-border",
        deleting && "opacity-60",
      )}
    >
      <SourceFavicon source={activeSource} className="size-8" />

      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
          <SourceNameEditor
            sourceId={activeSource.id}
            name={activeSource.name}
            canEdit={canEditName}
            onUpdated={(nextName) => onNameUpdated?.(activeSource.id, nextName)}
            className="min-w-0"
          />
          <SourceVersionSelect
            versions={
              source.versions.length > 0
                ? source.versions
                : [
                    {
                      id: source.id,
                      versionNumber: source.versionNumber ?? 1,
                      versionLabel: source.versionLabel ?? "v1",
                      indexedAt: source.indexedAt,
                      chunkCount: source.chunkCount,
                      pageCount: source.pageCount,
                    },
                  ]
            }
            value={activeSource.id}
            onChange={setSelectedVersionId}
          />
          {(source.scope ?? "personal") === "global" ? (
            <span className="rounded-md border border-accent/30 bg-accent/10 px-1.5 py-0.5 font-mono text-[0.5rem] font-semibold tracking-[0.08em] text-accent uppercase">
              Public
            </span>
          ) : null}
        </div>

        <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
          <SourceSlugEditor
            sourceId={activeSource.id}
            slug={activeSource.slug}
            canEdit={canEditSlug}
            onUpdated={(nextSlug) => onSlugUpdated?.(activeSource.id, nextSlug)}
          />
          <p className="truncate font-mono text-[0.625rem] text-muted/80">
            {label}
          </p>
        </div>

        <SourceCategoryBadges
          categories={source.categories ?? []}
          className="mt-1"
        />
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <Link
          href={`/sources/${activeSource.id}/chat`}
          className={cn(
            "inline-flex min-w-[5rem] items-center justify-center rounded-lg px-3 py-2 text-sm font-medium transition-colors sm:min-w-[5.5rem]",
            activeSource.chunkCount > 0
              ? "bg-foreground text-background hover:opacity-90"
              : "cursor-not-allowed border border-border bg-surface-raised text-muted",
          )}
          aria-disabled={activeSource.chunkCount === 0}
          onClick={(event) => {
            if (activeSource.chunkCount === 0) event.preventDefault();
          }}
        >
          Chat
        </Link>
        {showActionsMenu ? (
          <SourceActionsMenu
            source={activeSource}
            deleting={deleting}
            onDelete={onDelete ? handleDelete : undefined}
            canEditCategories={canEditCategories}
            onCategoriesUpdated={(categories) =>
              onCategoriesUpdated?.(
                source.sourceFamilyId || source.id,
                categories,
              )
            }
            onNameUpdated={(name) => onNameUpdated?.(activeSource.id, name)}
            onSlugUpdated={(slug) => onSlugUpdated?.(activeSource.id, slug)}
            onRefreshApplied={onRefreshApplied}
          />
        ) : null}
      </div>
    </article>
  );
}
