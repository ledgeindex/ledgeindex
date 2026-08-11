"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { CachedRemoteImage } from "@/components/sources/cached-remote-image";
import { SourceActionsMenu } from "@/components/sources/source-actions-menu";
import { SourceCategoryBadges } from "@/components/sources/source-category-filter";
import { SourceProfileBadge } from "@/components/sources/source-profile-badge";
import { SourceSlugEditor } from "@/components/sources/source-slug-editor";
import { SourceNameEditor } from "@/components/sources/source-name-editor";
import {
  resolveSourceVersion,
  SourceVersionSelect,
} from "@/components/sources/source-version-select";
import { formatUrlLabel } from "@/components/sources/source-display";
import {
  isPersonalCloudSource,
  SourceCloudBadge,
} from "@/components/sources/source-cloud-badge";
import { SourceSiteProfileDialog } from "@/components/sources/source-site-profile-dialog";
import { cn } from "@/lib/utils";
import type { SourceSummary } from "@/lib/ledgeindex-api";

function SourceCardFavicon({
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

export function SourceCard({
  source,
  highlighted = false,
  onDelete,
  deleting = false,
  canEditSlug = false,
  canEditName = false,
  canEditCategories = false,
  onSlugUpdated,
  onNameUpdated,
  onCategoriesUpdated,
  onRefreshApplied,
  onSiteProfileUpdated,
}: {
  source: SourceSummary;
  highlighted?: boolean;
  onDelete?: (sourceId: string) => void | Promise<void>;
  deleting?: boolean;
  canEditSlug?: boolean;
  canEditName?: boolean;
  canEditCategories?: boolean;
  onSlugUpdated?: (sourceId: string, slug: string) => void;
  onNameUpdated?: (sourceId: string, name: string) => void;
  onCategoriesUpdated?: (sourceId: string, categories: string[]) => void;
  onRefreshApplied?: () => void;
  onSiteProfileUpdated?: (
    sourceId: string,
    payload: { hasSiteProfile: boolean; siteProfileLensCount: number },
  ) => void;
}) {
  const [selectedVersionId, setSelectedVersionId] = useState(source.id);
  const [profileOpen, setProfileOpen] = useState(false);
  const activeSource = useMemo(
    () => resolveSourceVersion(source, selectedVersionId),
    [source, selectedVersionId],
  );
  const label = formatUrlLabel(activeSource.startUrl || activeSource.name);
  const initials = activeSource.name.slice(0, 2).toUpperCase();

  function handleDelete() {
    if (!onDelete || deleting) return;
    const deleteLabel = activeSource.name || activeSource.startUrl || "this set";
    const confirmed = window.confirm(
      `Delete "${deleteLabel}" (${activeSource.versionLabel})?\n\nThis removes this version, its vectors, and catalog. This cannot be undone.`,
    );
    if (!confirmed) return;
    void onDelete(activeSource.id);
  }

  return (
    <article
      title={`${activeSource.pageCount} pages · ${activeSource.chunkCount} chunks`}
      className={cn(
        "flex min-w-0 flex-col rounded-xl border bg-card-solid shadow-card transition-[border-color,box-shadow] duration-700",
        highlighted
          ? "border-emerald-500/40 ring-1 ring-emerald-500/20"
          : "border-border",
        deleting && "opacity-60",
      )}
    >
      <div className="relative aspect-video overflow-hidden rounded-t-xl border-b border-border bg-black">
        {activeSource.ogImageUrl ? (
          <CachedRemoteImage
            sourceId={activeSource.id}
            url={activeSource.ogImageUrl}
            className="size-full object-contain object-center"
          />
        ) : (
          <div className="flex size-full items-center justify-center">
            <span className="font-mono text-3xl font-semibold text-foreground/40">
              {initials}
            </span>
          </div>
        )}
        {isPersonalCloudSource(activeSource) ? (
          <SourceCloudBadge className="absolute right-2 bottom-2" />
        ) : null}
      </div>

      <div className="flex flex-1 flex-col gap-4 px-4 pb-4 pt-3.5">
        <div className="flex min-w-0 items-start gap-3">
          <div className="min-w-0 flex-1">
            <SourceNameEditor
              sourceId={activeSource.id}
              name={activeSource.name}
              canEdit={canEditName}
              onUpdated={(nextName) => onNameUpdated?.(activeSource.id, nextName)}
              className="w-full"
            />
            <SourceSlugEditor
              sourceId={activeSource.id}
              slug={activeSource.slug}
              canEdit={canEditSlug}
              onUpdated={(nextSlug) => onSlugUpdated?.(activeSource.id, nextSlug)}
            />
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <SourceVersionSelect
                versions={source.versions.length > 0 ? source.versions : [{
                  id: source.id,
                  versionNumber: source.versionNumber ?? 1,
                  versionLabel: source.versionLabel ?? "v1",
                  indexedAt: source.indexedAt,
                  chunkCount: source.chunkCount,
                  pageCount: source.pageCount,
                }]}
                value={activeSource.id}
                onChange={setSelectedVersionId}
              />
              {activeSource.hasSiteProfile ? (
                <SourceProfileBadge
                  lensCount={activeSource.siteProfileLensCount}
                  onClick={() => setProfileOpen(true)}
                />
              ) : null}
              <p className="truncate font-mono text-[0.625rem] text-muted/80">
                {label}
              </p>
            </div>
            <SourceCategoryBadges
              categories={source.categories ?? []}
              className="mt-1.5"
            />
          </div>
          <SourceCardFavicon source={activeSource} className="size-8" />
        </div>

        <div className="mt-auto flex items-center gap-2 pt-1">
          <Link
            href={`/sources/${activeSource.id}/chat`}
            className={cn(
              "inline-flex flex-1 items-center justify-center rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
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
          <SourceActionsMenu
            source={activeSource}
            deleting={deleting}
            onDelete={onDelete ? handleDelete : undefined}
            canEditCategories={canEditCategories}
            onCategoriesUpdated={(categories) =>
              onCategoriesUpdated?.(source.sourceFamilyId || source.id, categories)
            }
            onNameUpdated={(name) => onNameUpdated?.(activeSource.id, name)}
            onSlugUpdated={(slug) => onSlugUpdated?.(activeSource.id, slug)}
            onRefreshApplied={onRefreshApplied}
            onSiteProfileUpdated={(payload) =>
              onSiteProfileUpdated?.(activeSource.id, payload)
            }
          />
        </div>
      </div>

      <SourceSiteProfileDialog
        source={activeSource}
        open={profileOpen}
        onOpenChange={setProfileOpen}
        initialMode="view"
        onSaved={(payload) =>
          onSiteProfileUpdated?.(activeSource.id, payload)
        }
      />
    </article>
  );
}
