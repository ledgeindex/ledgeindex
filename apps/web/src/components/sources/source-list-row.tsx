"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, type CSSProperties } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { CachedRemoteImage } from "@/components/sources/cached-remote-image";
import {
  SourceActionsMenu,
  type SourceActionsMenuPoint,
} from "@/components/sources/source-actions-menu";
import { SourceSlugEditor } from "@/components/sources/source-slug-editor";
import { SourceNameEditor } from "@/components/sources/source-name-editor";
import {
  resolveSourceVersion,
  SourceVersionSelect,
} from "@/components/sources/source-version-select";
import { formatUrlLabel } from "@/components/sources/source-display";
import {
  resolveStartUrls,
  SourceStartUrlsHint,
} from "@/components/sources/source-start-urls-hint";
import { cn } from "@/lib/utils";
import type { SourceSummary } from "@/lib/ledgeindex-api";

export function sourceListRowId(source: SourceSummary): string {
  return source.sourceFamilyId || source.id;
}

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
          "shrink-0 rounded-md border border-border bg-background object-contain p-0.5",
          className,
        )}
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center rounded-md border border-border bg-surface-raised font-mono text-[0.5625rem] font-semibold text-foreground/50",
        className,
      )}
      aria-hidden
    >
      {initials}
    </div>
  );
}

/** Lightweight floating preview while dragging. */
export function SourceListRowDragPreview({
  source,
  rank,
}: {
  source: SourceSummary;
  rank?: number;
}) {
  const path = formatUrlLabel(source.startUrl || source.name);
  const startUrls = resolveStartUrls(source);
  return (
    <div className="flex h-12 w-[min(36rem,calc(100vw-2rem))] items-center gap-2 rounded-lg border border-accent/40 bg-card-solid px-2.5 shadow-lg">
      <GripVertical className="size-3.5 shrink-0 text-muted" aria-hidden />
      <SourceFavicon source={source} className="size-7" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[0.8125rem] leading-4 font-semibold text-foreground">
          {source.name}
        </p>
        <p className="truncate font-mono text-[0.5625rem] leading-3.5 text-muted">
          <span>{source.slug}</span>
          {startUrls.length > 0 ? (
            <span className="inline-flex min-w-0 max-w-[min(100%,12rem)] items-center gap-1 align-middle">
              <span className="text-muted/50"> · </span>
              <SourceStartUrlsHint urls={startUrls} />
            </span>
          ) : path ? (
            <span className="text-muted/70"> · {path}</span>
          ) : null}
        </p>
      </div>
      {typeof rank === "number" ? (
        <span className="shrink-0 w-6 text-right font-mono text-[0.6875rem] font-semibold tabular-nums text-muted">
          {rank}
        </span>
      ) : null}
    </div>
  );
}

export function SourceListRow({
  source,
  rank,
  highlighted = false,
  onDelete,
  deleting = false,
  canEditSlug = false,
  canEditName = false,
  canEditCategories = false,
  canReorder = false,
  showActionsMenu = true,
  onSlugUpdated,
  onNameUpdated,
  onCategoriesUpdated,
  onRefreshApplied,
  onSiteProfileUpdated,
}: {
  source: SourceSummary;
  /** 1-based catalog rank in the current ordered list. */
  rank?: number;
  highlighted?: boolean;
  onDelete?: (sourceId: string) => void | Promise<void>;
  deleting?: boolean;
  canEditSlug?: boolean;
  canEditName?: boolean;
  canEditCategories?: boolean;
  canReorder?: boolean;
  showActionsMenu?: boolean;
  onSlugUpdated?: (sourceId: string, slug: string) => void;
  onNameUpdated?: (sourceId: string, name: string) => void;
  onCategoriesUpdated?: (sourceId: string, categories: string[]) => void;
  onRefreshApplied?: () => void;
  onSiteProfileUpdated?: (
    sourceId: string,
    payload: { hasSiteProfile: boolean; siteProfileLensCount: number },
  ) => void;
}) {
  const router = useRouter();
  const rowId = sourceListRowId(source);
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: rowId,
    disabled: !canReorder,
  });
  const [selectedVersionId, setSelectedVersionId] = useState(source.id);
  const [contextPoint, setContextPoint] =
    useState<SourceActionsMenuPoint | null>(null);
  const activeSource = useMemo(
    () => resolveSourceVersion(source, selectedVersionId),
    [source, selectedVersionId],
  );
  const startUrls = useMemo(
    () => resolveStartUrls(activeSource),
    [activeSource],
  );
  const pathLabel = formatUrlLabel(activeSource.startUrl || activeSource.name);
  const canChat = activeSource.chunkCount > 0;
  const chatHref = `/sources/${activeSource.id}/chat`;
  const versions =
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
        ];
  const showVersionSelect = versions.length > 1;

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition: isDragging ? undefined : transition,
    opacity: isDragging ? 0 : undefined,
  };

  function handleDelete() {
    if (!onDelete || deleting) return;
    const deleteLabel = source.name || source.startUrl || "this set";
    const confirmed = window.confirm(
      `Delete "${deleteLabel}"?\n\nThis removes the set, its vectors, and catalog. This cannot be undone.`,
    );
    if (!confirmed) return;
    void onDelete(activeSource.id);
  }

  function openChat() {
    if (!canChat || deleting || isDragging) return;
    router.push(chatHref);
  }

  return (
    <article
      ref={setNodeRef}
      style={style}
      title={
        canChat
          ? showActionsMenu
            ? `${activeSource.pageCount} pages · ${activeSource.chunkCount} chunks — open chat · right-click for admin actions`
            : `${activeSource.pageCount} pages · ${activeSource.chunkCount} chunks — open chat`
          : `${activeSource.name} — indexing incomplete`
      }
      onClick={openChat}
      onKeyDown={(event) => {
        const target = event.target as HTMLElement | null;
        if (target?.closest("input, textarea, select, button, a")) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openChat();
        }
      }}
      onContextMenu={(event) => {
        if (!showActionsMenu) return;
        event.preventDefault();
        event.stopPropagation();
        setContextPoint({ x: event.clientX, y: event.clientY });
      }}
      role="link"
      tabIndex={canChat ? 0 : -1}
      aria-disabled={!canChat}
      className={cn(
        "flex h-12 items-center gap-2 rounded-lg border bg-card-solid px-2.5 transition-[border-color,box-shadow,opacity] duration-150",
        "hover:border-foreground/20 hover:bg-surface-raised/40",
        "focus-visible:border-foreground/25 focus-visible:ring-1 focus-visible:ring-foreground/10 focus-visible:outline-none",
        highlighted
          ? "border-emerald-500/40 ring-1 ring-emerald-500/20"
          : "border-border",
        deleting && "pointer-events-none opacity-60",
        isDragging && "pointer-events-none shadow-none",
        canChat ? "cursor-pointer" : "cursor-not-allowed opacity-70",
      )}
    >
      {canReorder ? (
        <button
          type="button"
          aria-label="Drag to reorder"
          title="Drag to reorder"
          className="-ml-0.5 shrink-0 cursor-grab touch-none rounded p-0.5 text-muted hover:text-foreground active:cursor-grabbing"
          onClick={(event) => event.stopPropagation()}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-3.5" aria-hidden />
        </button>
      ) : null}

      <SourceFavicon source={activeSource} className="size-7" />

      <div className="min-w-0 flex-1 overflow-hidden">
        <div
          className="min-w-0"
          onClick={(event) => {
            if (canEditName) event.stopPropagation();
          }}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <SourceNameEditor
            sourceId={activeSource.id}
            name={activeSource.name}
            canEdit={canEditName}
            onUpdated={(nextName) =>
              onNameUpdated?.(activeSource.id, nextName)
            }
            className="max-w-full truncate [&_button]:max-w-full [&_button]:px-0 [&_button]:py-0 [&_button]:hover:border-transparent [&_button]:hover:bg-transparent [&_span]:text-[0.8125rem] [&_span]:leading-4"
          />
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-1 overflow-hidden">
          <div
            className="min-w-0 shrink truncate"
            onClick={(event) => {
              if (canEditSlug) event.stopPropagation();
            }}
            onKeyDown={(event) => event.stopPropagation()}
          >
            <SourceSlugEditor
              sourceId={activeSource.id}
              slug={activeSource.slug}
              canEdit={canEditSlug}
              onUpdated={(nextSlug) =>
                onSlugUpdated?.(activeSource.id, nextSlug)
              }
              className="max-w-full [&_button]:px-0 [&_button]:py-0 [&_button]:hover:border-transparent [&_button]:hover:bg-transparent"
            />
          </div>
          {startUrls.length > 0 ? (
            <div
              className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden"
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => event.stopPropagation()}
            >
              <span className="shrink-0 font-mono text-[0.5625rem] text-muted/50">
                ·
              </span>
              <SourceStartUrlsHint urls={startUrls} />
            </div>
          ) : pathLabel ? (
            <p className="min-w-0 truncate font-mono text-[0.5625rem] leading-3.5 text-muted/75">
              · {pathLabel}
            </p>
          ) : null}
        </div>
      </div>

      {showVersionSelect ? (
        <div
          className="hidden shrink-0 sm:block"
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <SourceVersionSelect
            versions={versions}
            value={activeSource.id}
            onChange={setSelectedVersionId}
          />
        </div>
      ) : null}

      {typeof rank === "number" ? (
        <span
          className="shrink-0 w-6 text-right font-mono text-[0.6875rem] font-semibold tabular-nums text-muted"
          title={`Rank ${rank}`}
          aria-label={`Rank ${rank}`}
        >
          {rank}
        </span>
      ) : null}

      {showActionsMenu ? (
        <div
          className="shrink-0"
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
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
            onSiteProfileUpdated={(payload) =>
              onSiteProfileUpdated?.(activeSource.id, payload)
            }
            className="size-7 md:hidden"
            contextPoint={contextPoint}
            onContextPointChange={setContextPoint}
          />
        </div>
      ) : null}
    </article>
  );
}
