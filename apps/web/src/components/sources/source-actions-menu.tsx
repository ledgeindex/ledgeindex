"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { SourceCatalogDialog } from "@/components/sources/source-catalog-dialog";
import { SourceCategoriesDialog } from "@/components/sources/source-categories-dialog";
import { SourceRefreshDialog } from "@/components/sources/source-refresh-dialog";
import {
  SourceRenameDialog,
  type SourceRenameField,
} from "@/components/sources/source-rename-dialog";
import {
  SOURCE_KIND_PRESETS,
  mergeSourceCategories,
  splitSourceCategories,
} from "@/lib/source-category-presets";
import { updateSourceCategories } from "@/lib/ledgeindex-api";
import { cn } from "@/lib/utils";
import type { SourceSummary } from "@/lib/ledgeindex-api";

const MENU_WIDTH = 176;
const SUBMENU_WIDTH = 168;

export type SourceActionsMenuPoint = {
  x: number;
  y: number;
};

export function SourceActionsMenu({
  source,
  deleting = false,
  onDelete,
  canEditCategories = false,
  onCategoriesUpdated,
  onNameUpdated,
  onSlugUpdated,
  onRefreshApplied,
  className,
  align = "right",
  /** Hide the ⋮ button — open via `contextPoint` (right-click). */
  hideTrigger = false,
  contextPoint = null,
  onContextPointChange,
}: {
  source: SourceSummary;
  deleting?: boolean;
  onDelete?: () => void;
  canEditCategories?: boolean;
  onCategoriesUpdated?: (categories: string[]) => void;
  onNameUpdated?: (name: string) => void;
  onSlugUpdated?: (slug: string) => void;
  onRefreshApplied?: () => void;
  className?: string;
  align?: "left" | "right";
  hideTrigger?: boolean;
  contextPoint?: SourceActionsMenuPoint | null;
  onContextPointChange?: (point: SourceActionsMenuPoint | null) => void;
}) {
  const [buttonOpen, setButtonOpen] = useState(false);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [refreshOpen, setRefreshOpen] = useState(false);
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [renameField, setRenameField] = useState<SourceRenameField | null>(
    null,
  );
  const [shelfSubmenuOpen, setShelfSubmenuOpen] = useState(false);
  const [savingShelf, setSavingShelf] = useState(false);
  const [menuRect, setMenuRect] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);
  const [submenuSide, setSubmenuSide] = useState<"right" | "left">("right");
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const shelfItemRef = useRef<HTMLDivElement>(null);
  const recrawlHref = `/sources/web-crawl?url=${encodeURIComponent(source.startUrl)}${
    (source.scope ?? "personal") === "global" ? "&scope=global" : ""
  }&mode=replace&replaceSourceId=${encodeURIComponent(source.id)}`;
  const reviewSelectionHref = `/sources/web-crawl?url=${encodeURIComponent(source.startUrl)}${
    (source.scope ?? "personal") === "global" ? "&scope=global" : ""
  }&mode=refresh-select&sourceId=${encodeURIComponent(source.id)}`;

  const open = hideTrigger ? Boolean(contextPoint) : buttonOpen;
  const currentKind = splitSourceCategories(source.categories ?? []).kind;

  const closeMenu = useCallback(() => {
    setButtonOpen(false);
    setShelfSubmenuOpen(false);
    onContextPointChange?.(null);
  }, [onContextPointChange]);

  const estimateMenuHeight = useCallback(() => {
    return (
      88 +
      (source.chunkCount > 0 && canEditCategories ? 64 : 0) +
      (canEditCategories ? 32 + 64 : 0) +
      (onDelete ? 32 : 0)
    );
  }, [onDelete, canEditCategories, source.chunkCount]);

  const syncMenuRect = useCallback(() => {
    const width = MENU_WIDTH;
    const menuHeight = estimateMenuHeight();

    if (contextPoint) {
      const left = Math.min(
        Math.max(12, contextPoint.x),
        window.innerWidth - width - 12,
      );
      const belowTop = contextPoint.y + 4;
      const aboveTop = contextPoint.y - menuHeight - 4;
      const top =
        belowTop + menuHeight > window.innerHeight - 12 && aboveTop >= 12
          ? aboveTop
          : Math.min(belowTop, window.innerHeight - menuHeight - 12);
      setMenuRect({ top, left, width });
      setSubmenuSide(
        left + width + SUBMENU_WIDTH + 8 > window.innerWidth ? "left" : "right",
      );
      return;
    }

    const button = buttonRef.current;
    if (!button) return;

    const rect = button.getBoundingClientRect();
    const left =
      align === "left"
        ? Math.min(rect.left, window.innerWidth - width - 12)
        : Math.max(12, rect.right - width);
    const belowTop = rect.bottom + 4;
    const aboveTop = rect.top - menuHeight - 4;
    const top =
      belowTop + menuHeight > window.innerHeight - 12 && aboveTop >= 12
        ? aboveTop
        : belowTop;

    setMenuRect({
      top,
      left,
      width,
    });
    setSubmenuSide(
      left + width + SUBMENU_WIDTH + 8 > window.innerWidth ? "left" : "right",
    );
  }, [align, contextPoint, estimateMenuHeight]);

  useEffect(() => {
    if (!open) {
      setMenuRect(null);
      setShelfSubmenuOpen(false);
      return;
    }

    syncMenuRect();

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        !buttonRef.current?.contains(target) &&
        !menuRef.current?.contains(target)
      ) {
        closeMenu();
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMenu();
    };

    window.addEventListener("resize", syncMenuRect);
    window.addEventListener("scroll", syncMenuRect, true);
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("resize", syncMenuRect);
      window.removeEventListener("scroll", syncMenuRect, true);
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, syncMenuRect, closeMenu]);

  async function assignShelf(kind: string | null) {
    if (savingShelf) return;
    setSavingShelf(true);
    try {
      const parsed = splitSourceCategories(source.categories ?? []);
      const next = mergeSourceCategories({
        kind,
        languages: parsed.languages,
        custom: parsed.custom,
      });
      const { source: updated } = await updateSourceCategories(source.id, next);
      onCategoriesUpdated?.(updated.categories ?? next);
      closeMenu();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not update shelf";
      window.alert(message);
    } finally {
      setSavingShelf(false);
    }
  }

  const menu =
    open && menuRect
      ? createPortal(
          <div
            ref={menuRef}
            role="menu"
            style={{
              position: "fixed",
              top: menuRect.top,
              left: menuRect.left,
              width: menuRect.width,
              zIndex: 200,
            }}
            className="rounded-lg border border-border bg-card-solid py-1 shadow-card"
          >
            <button
              type="button"
              role="menuitem"
              disabled={source.chunkCount === 0}
              onClick={() => {
                closeMenu();
                setCatalogOpen(true);
              }}
              className="flex w-full items-center px-3 py-2 text-left text-xs font-medium text-foreground transition-colors hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-50"
            >
              Catalog
            </button>
            {canEditCategories && source.chunkCount > 0 ? (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  closeMenu();
                  setRefreshOpen(true);
                }}
                className="flex w-full items-center px-3 py-2 text-left text-xs font-medium text-foreground transition-colors hover:bg-surface-raised"
              >
                Check updates
              </button>
            ) : null}
            {canEditCategories && source.chunkCount > 0 ? (
              <Link
                href={reviewSelectionHref}
                role="menuitem"
                onClick={() => closeMenu()}
                className="flex w-full items-center px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-surface-raised"
              >
                Review selection
              </Link>
            ) : null}
            {canEditCategories ? (
              <>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    closeMenu();
                    setRenameField("name");
                  }}
                  className="flex w-full items-center px-3 py-2 text-left text-xs font-medium text-foreground transition-colors hover:bg-surface-raised"
                >
                  Rename title
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    closeMenu();
                    setRenameField("slug");
                  }}
                  className="flex w-full items-center px-3 py-2 text-left text-xs font-medium text-foreground transition-colors hover:bg-surface-raised"
                >
                  Rename slug
                </button>
              </>
            ) : null}
            {canEditCategories ? (
              <div
                ref={shelfItemRef}
                className="relative"
                onMouseEnter={() => setShelfSubmenuOpen(true)}
                onFocus={() => setShelfSubmenuOpen(true)}
              >
                <button
                  type="button"
                  role="menuitem"
                  aria-haspopup="menu"
                  aria-expanded={shelfSubmenuOpen}
                  disabled={savingShelf}
                  onClick={() => setShelfSubmenuOpen((open) => !open)}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs font-medium text-foreground transition-colors hover:bg-surface-raised disabled:opacity-50",
                    shelfSubmenuOpen && "bg-surface-raised",
                  )}
                >
                  <span>{savingShelf ? "Saving…" : "Set shelf"}</span>
                  <ChevronRight className="size-3.5 shrink-0 text-muted" aria-hidden />
                </button>

                {shelfSubmenuOpen ? (
                  <div
                    role="menu"
                    style={{ width: SUBMENU_WIDTH }}
                    className={cn(
                      "absolute top-0 z-[1] rounded-lg border border-border bg-card-solid py-1 shadow-card",
                      submenuSide === "right"
                        ? "left-full ml-1"
                        : "right-full mr-1",
                    )}
                  >
                    {SOURCE_KIND_PRESETS.map((preset) => {
                      const active = currentKind === preset.slug;
                      return (
                        <button
                          key={preset.slug}
                          type="button"
                          role="menuitemradio"
                          aria-checked={active}
                          disabled={savingShelf}
                          onClick={() => void assignShelf(preset.slug)}
                          className={cn(
                            "flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs font-medium transition-colors hover:bg-surface-raised disabled:opacity-50",
                            active
                              ? "bg-foreground/5 text-foreground"
                              : "text-foreground",
                          )}
                        >
                          <span>{preset.label}</span>
                          {active ? (
                            <span className="text-[0.625rem] text-muted">✓</span>
                          ) : null}
                        </button>
                      );
                    })}
                    <div className="my-1 border-t border-border" />
                    <button
                      type="button"
                      role="menuitem"
                      disabled={savingShelf || !currentKind}
                      onClick={() => void assignShelf(null)}
                      className="flex w-full items-center px-3 py-2 text-left text-xs font-medium text-foreground transition-colors hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Uncategorized
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      disabled={savingShelf}
                      onClick={() => {
                        closeMenu();
                        setCategoriesOpen(true);
                      }}
                      className="flex w-full items-center px-3 py-2 text-left text-xs font-medium text-muted transition-colors hover:bg-surface-raised hover:text-foreground disabled:opacity-50"
                    >
                      More options…
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}
            <Link
              href={recrawlHref}
              role="menuitem"
              onClick={() => closeMenu()}
              className="flex w-full items-center px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-surface-raised"
            >
              Re-crawl
            </Link>
            {onDelete ? (
              <button
                type="button"
                role="menuitem"
                disabled={deleting}
                onClick={() => {
                  closeMenu();
                  onDelete();
                }}
                className="flex w-full items-center px-3 py-2 text-left text-xs font-medium text-red-600 transition-colors hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-50 dark:text-red-300"
              >
                {deleting ? "Deleting…" : "Delete"}
              </button>
            ) : null}
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      {!hideTrigger ? (
        <button
          ref={buttonRef}
          type="button"
          onClick={() => {
            if (buttonOpen) {
              closeMenu();
              return;
            }
            syncMenuRect();
            setButtonOpen(true);
          }}
          disabled={deleting}
          aria-expanded={open}
          aria-haspopup="menu"
          aria-label={`More actions for ${source.name}`}
          className={cn(
            "inline-flex size-8 items-center justify-center rounded-lg border border-border bg-surface-raised text-muted transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50",
            className,
          )}
        >
          <MoreMenuIcon />
        </button>
      ) : null}

      {menu}

      <SourceCatalogDialog
        sourceId={source.id}
        sourceName={source.name}
        open={catalogOpen}
        onOpenChange={setCatalogOpen}
      />

      {canEditCategories ? (
        <SourceRefreshDialog
          sourceId={source.id}
          sourceName={source.name}
          sourceStartUrl={source.startUrl}
          sourceScope={source.scope ?? "personal"}
          open={refreshOpen}
          onOpenChange={setRefreshOpen}
          onApplied={onRefreshApplied}
        />
      ) : null}

      {canEditCategories ? (
        <SourceCategoriesDialog
          source={source}
          open={categoriesOpen}
          onOpenChange={setCategoriesOpen}
          onSaved={(categories) => onCategoriesUpdated?.(categories)}
        />
      ) : null}

      {canEditCategories && renameField ? (
        <SourceRenameDialog
          sourceId={source.id}
          field={renameField}
          initialValue={renameField === "slug" ? source.slug : source.name}
          open
          onOpenChange={(next) => {
            if (!next) setRenameField(null);
          }}
          onSaved={(value) => {
            if (renameField === "slug") onSlugUpdated?.(value);
            else onNameUpdated?.(value);
          }}
        />
      ) : null}
    </>
  );
}

function MoreMenuIcon() {
  return (
    <svg viewBox="0 0 20 20" className="size-4" fill="currentColor" aria-hidden>
      <circle cx="10" cy="4.5" r="1.5" />
      <circle cx="10" cy="10" r="1.5" />
      <circle cx="10" cy="15.5" r="1.5" />
    </svg>
  );
}
