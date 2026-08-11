"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";
import { CachedRemoteImage } from "@/components/sources/cached-remote-image";
import {
  SourceActionsMenu,
  type SourceActionsMenuPoint,
} from "@/components/sources/source-actions-menu";
import { SourceProfileBadge } from "@/components/sources/source-profile-badge";
import { SourceSiteProfileDialog } from "@/components/sources/source-site-profile-dialog";
import { resolveSourceVersion } from "@/components/sources/source-version-select";
import { formatUrlLabel } from "@/components/sources/source-display";
import {
  isPersonalCloudSource,
  SourceCloudBadge,
} from "@/components/sources/source-cloud-badge";
import { cn } from "@/lib/utils";
import type { SourceSummary } from "@/lib/ledgeindex-api";

function BannerFavicon({
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
          "shrink-0 rounded-md border border-border/80 bg-background object-contain p-0.5",
          className,
        )}
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center rounded-md border border-border/80 bg-surface-raised font-mono text-[0.5625rem] font-semibold text-foreground/45",
        className,
      )}
      aria-hidden
    >
      {initials}
    </div>
  );
}

function resolveStartUrls(source: SourceSummary): string[] {
  const fromList = (source.startUrls ?? []).filter(Boolean);
  if (fromList.length > 0) return [...new Set(fromList)];
  return source.startUrl ? [source.startUrl] : [];
}

/** Path after host for glance label, e.g. https://mastra.ai/docs → /docs */
function formatStartUrlPathLabel(url: string): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/\/+$/, "") || "/";
    return path;
  } catch {
    const slash = url.lastIndexOf("/");
    if (slash >= 0 && slash < url.length - 1) {
      return `/${url.slice(slash + 1)}`;
    }
    return url;
  }
}

function StartUrlsHint({ urls }: { urls: string[] }) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const count = urls.length;

  useEffect(() => {
    if (!open) return;

    const sync = () => {
      const button = buttonRef.current;
      if (!button) return;
      const box = button.getBoundingClientRect();
      const width = 260;
      const left = Math.min(
        Math.max(12, box.left),
        window.innerWidth - width - 12,
      );
      const top = Math.min(box.bottom + 4, window.innerHeight - 12);
      setRect({ top, left });
    };

    sync();

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        !buttonRef.current?.contains(target) &&
        !panelRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    window.addEventListener("resize", sync);
    window.addEventListener("scroll", sync, true);
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("resize", sync);
      window.removeEventListener("scroll", sync, true);
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  if (count === 0) return null;

  const firstPath = formatStartUrlPathLabel(urls[0]!);
  const label =
    count === 1 ? firstPath : `${firstPath} +${count - 1}`;

  const panel =
    open && rect
      ? createPortal(
          <div
            ref={panelRef}
            role="dialog"
            aria-label="Start URLs"
            style={{
              position: "fixed",
              top: rect.top,
              left: rect.left,
              width: 260,
              zIndex: 220,
            }}
            className="max-h-56 overflow-auto rounded-lg border border-border bg-card-solid py-1.5 shadow-card"
            onClick={(event) => event.stopPropagation()}
          >
            <p className="px-3 pb-1 font-mono text-[0.5rem] font-semibold tracking-[0.1em] text-muted uppercase">
              Start URLs
            </p>
            <ul className="space-y-0.5">
              {urls.map((url) => (
                <li key={url}>
                  <a
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    title={url}
                    className="block truncate px-3 py-1.5 text-xs text-foreground transition-colors hover:bg-surface-raised hover:text-accent"
                    onClick={(event) => event.stopPropagation()}
                  >
                    {formatUrlLabel(url)}
                  </a>
                </li>
              ))}
            </ul>
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        title={
          count === 1
            ? urls[0]
            : `${count} start URLs — click to view`
        }
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setOpen((current) => !current);
        }}
        className={cn(
          "inline-flex max-w-full items-center gap-0.5 truncate rounded-sm normal-case tracking-normal text-muted transition-colors",
          "hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-foreground/20",
          open && "text-foreground",
        )}
      >
        <span className="truncate">{label}</span>
        <ChevronDown
          className={cn(
            "size-3 shrink-0 opacity-70 transition-transform",
            open && "rotate-180",
          )}
          aria-hidden
        />
      </button>
      {panel}
    </>
  );
}

export function SourceBannerCard({
  source,
  highlighted = false,
  onDelete,
  deleting = false,
  canEditCategories = false,
  showContextMenu = false,
  onCategoriesUpdated,
  onNameUpdated,
  onSlugUpdated,
  onRefreshApplied,
  onSiteProfileUpdated,
}: {
  source: SourceSummary;
  highlighted?: boolean;
  onDelete?: (sourceId: string) => void | Promise<void>;
  deleting?: boolean;
  canEditCategories?: boolean;
  /** Admin-only right-click menu. */
  showContextMenu?: boolean;
  onCategoriesUpdated?: (sourceId: string, categories: string[]) => void;
  onNameUpdated?: (sourceId: string, name: string) => void;
  onSlugUpdated?: (sourceId: string, slug: string) => void;
  onRefreshApplied?: () => void;
  onSiteProfileUpdated?: (
    sourceId: string,
    payload: { hasSiteProfile: boolean; siteProfileLensCount: number },
  ) => void;
}) {
  const router = useRouter();
  const [contextPoint, setContextPoint] =
    useState<SourceActionsMenuPoint | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [ogFailed, setOgFailed] = useState(false);
  const activeSource = useMemo(
    () => resolveSourceVersion(source, source.id),
    [source],
  );
  useEffect(() => {
    setOgFailed(false);
  }, [activeSource.ogImageUrl, activeSource.id]);
  const startUrls = useMemo(
    () => resolveStartUrls(activeSource),
    [activeSource],
  );
  const canChat = activeSource.chunkCount > 0;
  const chatHref = `/sources/${activeSource.id}/chat`;

  function handleDelete() {
    if (!onDelete || deleting) return;
    const deleteLabel = activeSource.name || activeSource.startUrl || "this set";
    const confirmed = window.confirm(
      `Delete "${deleteLabel}"?\n\nThis removes the set, its vectors, and catalog. This cannot be undone.`,
    );
    if (!confirmed) return;
    void onDelete(activeSource.id);
  }

  function openChat() {
    if (!canChat) return;
    router.push(chatHref);
  }

  return (
    <>
      <article
        title={
          canChat
            ? showContextMenu
              ? `${activeSource.name} — open chat · right-click for admin actions`
              : `${activeSource.name} — open chat`
            : `${activeSource.name} — indexing incomplete`
        }
        className={cn(
          "group relative flex h-[4.25rem] min-w-0 cursor-pointer overflow-hidden rounded-lg border bg-card-solid shadow-card transition-[border-color,box-shadow,transform] duration-200",
          "hover:-translate-y-px hover:border-foreground/20 hover:shadow-md",
          "focus-within:border-foreground/25 focus-within:ring-1 focus-within:ring-foreground/10",
          highlighted
            ? "border-emerald-500/40 ring-1 ring-emerald-500/20"
            : "border-border",
          deleting && "pointer-events-none opacity-60",
          !canChat && "cursor-not-allowed opacity-70",
        )}
        onClick={openChat}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            openChat();
          }
        }}
        onContextMenu={(event) => {
          if (!showContextMenu) return;
          event.preventDefault();
          event.stopPropagation();
          setContextPoint({ x: event.clientX, y: event.clientY });
        }}
        role="link"
        tabIndex={canChat ? 0 : -1}
        aria-disabled={!canChat}
      >
        <div className="relative h-full w-[4.75rem] shrink-0 overflow-hidden border-r border-border/70 bg-black sm:w-[5.5rem]">
          {activeSource.ogImageUrl && !ogFailed ? (
            <CachedRemoteImage
              sourceId={activeSource.id}
              url={activeSource.ogImageUrl}
              className="size-full object-cover object-center opacity-90 transition-opacity group-hover:opacity-100"
              onError={() => setOgFailed(true)}
            />
          ) : (
            <div className="flex size-full items-center justify-center bg-surface-raised">
              <span className="font-mono text-sm font-semibold text-foreground/35">
                {activeSource.name.slice(0, 2).toUpperCase()}
              </span>
            </div>
          )}
          {isPersonalCloudSource(activeSource) ? (
            <SourceCloudBadge
              size="sm"
              className="absolute right-1 bottom-1"
            />
          ) : null}
        </div>

        <div className="flex min-w-0 flex-1 items-center gap-2.5 px-3 py-2">
          <BannerFavicon source={activeSource} className="size-7" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-foreground">
              {activeSource.name}
            </p>
            <div className="mt-0.5 flex min-w-0 items-center gap-1.5 font-mono text-[0.5625rem] tracking-[0.06em] text-muted uppercase">
              <span className="shrink-0">{activeSource.pageCount} pages</span>
              {activeSource.hasSiteProfile ? (
                <SourceProfileBadge
                  lensCount={activeSource.siteProfileLensCount}
                  onClick={() => setProfileOpen(true)}
                />
              ) : null}
              {startUrls.length > 0 ? (
                <>
                  <span className="shrink-0 text-muted/50" aria-hidden>
                    ·
                  </span>
                  <StartUrlsHint urls={startUrls} />
                </>
              ) : null}
            </div>
          </div>
        </div>
      </article>

      {showContextMenu ? (
        <SourceActionsMenu
          source={activeSource}
          hideTrigger
          contextPoint={contextPoint}
          onContextPointChange={setContextPoint}
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
      ) : null}

      <SourceSiteProfileDialog
        source={activeSource}
        open={profileOpen}
        onOpenChange={setProfileOpen}
        initialMode="view"
        onSaved={(payload) =>
          onSiteProfileUpdated?.(activeSource.id, payload)
        }
      />
    </>
  );
}
