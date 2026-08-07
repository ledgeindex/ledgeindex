"use client";

import {
  ChevronDown,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  Plus,
  X,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import {
  BuilderContextMenu,
  type BuilderContextMenuItem,
} from "@/components/source-builder/builder-context-menu";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  pagesForCategory,
  pagesForSubcategory,
  subcategoriesForCategory,
  type SourceBuilderDraft,
} from "@/lib/source-builder-draft";
import { cn } from "@/lib/utils";

function PageRow({
  title,
  active,
  onSelect,
  onDelete,
}: {
  title: string;
  active: boolean;
  onSelect: () => void;
  onDelete?: () => void;
}) {
  const [menuPoint, setMenuPoint] = useState<{ x: number; y: number } | null>(
    null,
  );

  const confirmDelete = useCallback(() => {
    if (!onDelete) return;
    const ok = window.confirm(`Delete page “${title}”?`);
    if (ok) onDelete();
  }, [onDelete, title]);

  const menuItems: BuilderContextMenuItem[] = onDelete
    ? [
        {
          id: "delete",
          label: "Delete page",
          destructive: true,
          onSelect: confirmDelete,
        },
      ]
    : [];

  return (
    <>
      <div
        className={cn(
          "group/page flex h-7 w-full items-center gap-1 rounded-lg pr-0.5 transition-colors",
          active
            ? "bg-[#FAFAFA] text-foreground shadow-sm dark:bg-surface-raised"
            : "text-muted-strong hover:bg-white/70 hover:text-foreground dark:hover:bg-surface-raised",
        )}
        onContextMenu={(event) => {
          if (!onDelete) return;
          event.preventDefault();
          event.stopPropagation();
          setMenuPoint({ x: event.clientX, y: event.clientY });
        }}
      >
        <button
          type="button"
          onClick={onSelect}
          className="flex min-w-0 flex-1 items-center gap-2 px-2 text-left text-xs"
        >
          <FileText className="size-3.5 shrink-0 opacity-70" />
          <span className="truncate">{title}</span>
        </button>
        {onDelete ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              confirmDelete();
            }}
            className={cn(
              "inline-flex size-5 shrink-0 items-center justify-center rounded text-muted transition-all",
              "opacity-0 pointer-events-none group-hover/page:opacity-100 group-hover/page:pointer-events-auto",
              "hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-400",
              "focus-visible:opacity-100 focus-visible:pointer-events-auto",
            )}
            aria-label={`Delete ${title}`}
            title="Delete page"
          >
            <X className="size-3" />
          </button>
        ) : null}
      </div>
      {menuItems.length > 0 ? (
        <BuilderContextMenu
          point={menuPoint}
          items={menuItems}
          onClose={() => setMenuPoint(null)}
        />
      ) : null}
    </>
  );
}

export function SourceBuilderStructureNav({
  draft,
  onSelectPage,
  onAddCategory,
  onAddSubcategory,
  onAddPage,
  onDeletePage,
}: {
  draft: SourceBuilderDraft;
  onSelectPage: (pageId: string) => void;
  onAddCategory?: () => void;
  onAddSubcategory?: (categoryId: string) => void;
  /** Add a page under a category (optional subcategory). */
  onAddPage?: (categoryId: string, subcategoryId?: string) => void;
  onDeletePage?: (pageId: string) => void;
}) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const groups = useMemo(
    () =>
      draft.categories.map((category) => ({
        category,
        subcategories: subcategoriesForCategory(category),
        directPages: pagesForCategory(draft, category.id),
      })),
    [draft],
  );

  function toggleCollapsed(id: string, open: boolean) {
    setCollapsed((current) => ({
      ...current,
      [id]: !open,
    }));
  }

  return (
    <aside className="flex h-full w-[13.5rem] shrink-0 flex-col border-r border-border bg-[#F8F8F8] dark:bg-surface-alt">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2.5">
        <p className="text-[0.62rem] font-semibold uppercase tracking-wide text-muted">
          Structure
        </p>
        {onAddCategory ? (
          <button
            type="button"
            onClick={onAddCategory}
            className="inline-flex size-6 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-raised hover:text-foreground"
            aria-label="Add category"
            title="Add category"
          >
            <Plus className="size-3.5" />
          </button>
        ) : null}
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {groups.length === 0 ? (
          <p className="px-2 py-3 text-xs text-muted">No categories yet.</p>
        ) : (
          <ul className="space-y-1">
            {groups.map(({ category, subcategories, directPages }) => {
              const open = !collapsed[category.id];
              return (
                <li key={category.id}>
                  <Collapsible
                    open={open}
                    onOpenChange={(next) => toggleCollapsed(category.id, next)}
                  >
                    <div className="flex items-center gap-0.5">
                      <CollapsibleTrigger className="flex min-w-0 flex-1 items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-[0.7rem] font-semibold uppercase tracking-wide text-muted transition-colors hover:bg-white/70 hover:text-foreground dark:hover:bg-surface-raised">
                        <ChevronDown
                          className={cn(
                            "size-3.5 shrink-0 transition-transform",
                            !open && "-rotate-90",
                          )}
                        />
                        <FolderOpen className="size-3.5 shrink-0" />
                        <span className="truncate">{category.title}</span>
                      </CollapsibleTrigger>
                      {onAddPage ? (
                        <button
                          type="button"
                          onClick={() => onAddPage(category.id)}
                          className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-white/70 hover:text-foreground dark:hover:bg-surface-raised"
                          aria-label={`Add page to ${category.title}`}
                          title="Add page"
                        >
                          <Plus className="size-3" />
                        </button>
                      ) : null}
                      {onAddSubcategory ? (
                        <button
                          type="button"
                          onClick={() => onAddSubcategory(category.id)}
                          className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-white/70 hover:text-foreground dark:hover:bg-surface-raised"
                          aria-label={`Add subcategory to ${category.title}`}
                          title="Add subcategory"
                        >
                          <FolderPlus className="size-3" />
                        </button>
                      ) : null}
                    </div>
                    <CollapsibleContent>
                      <ul className="mt-0.5 space-y-0.5 pb-1 pl-1">
                        {subcategories.map((subcategory) => {
                          const subOpen = !collapsed[subcategory.id];
                          const pages = pagesForSubcategory(
                            draft,
                            category.id,
                            subcategory.id,
                          );
                          return (
                            <li key={subcategory.id}>
                              <Collapsible
                                open={subOpen}
                                onOpenChange={(next) =>
                                  toggleCollapsed(subcategory.id, next)
                                }
                              >
                                <div className="flex items-center gap-0.5">
                                  <CollapsibleTrigger className="flex min-w-0 flex-1 items-center gap-1.5 rounded-lg px-2 py-1 text-left text-[0.68rem] font-medium text-muted-strong transition-colors hover:bg-white/70 hover:text-foreground dark:hover:bg-surface-raised">
                                    <ChevronDown
                                      className={cn(
                                        "size-3 shrink-0 transition-transform",
                                        !subOpen && "-rotate-90",
                                      )}
                                    />
                                    <Folder className="size-3 shrink-0 opacity-80" />
                                    <span className="truncate">
                                      {subcategory.title}
                                    </span>
                                  </CollapsibleTrigger>
                                  {onAddPage ? (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        onAddPage(category.id, subcategory.id)
                                      }
                                      className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-white/70 hover:text-foreground dark:hover:bg-surface-raised"
                                      aria-label={`Add page to ${subcategory.title}`}
                                      title="Add page"
                                    >
                                      <Plus className="size-3" />
                                    </button>
                                  ) : null}
                                </div>
                                <CollapsibleContent>
                                  <ul className="mt-0.5 space-y-0.5 pb-1 pl-3">
                                    {pages.map((page) => (
                                      <li key={page.id}>
                                        <PageRow
                                          title={page.title}
                                          active={
                                            draft.activePageId === page.id
                                          }
                                          onSelect={() =>
                                            onSelectPage(page.id)
                                          }
                                          onDelete={
                                            onDeletePage
                                              ? () => onDeletePage(page.id)
                                              : undefined
                                          }
                                        />
                                      </li>
                                    ))}
                                    {pages.length === 0 ? (
                                      <li className="px-2 py-1 text-[11px] text-muted">
                                        No pages
                                      </li>
                                    ) : null}
                                  </ul>
                                </CollapsibleContent>
                              </Collapsible>
                            </li>
                          );
                        })}

                        {directPages.map((page) => (
                          <li key={page.id}>
                            <PageRow
                              title={page.title}
                              active={draft.activePageId === page.id}
                              onSelect={() => onSelectPage(page.id)}
                              onDelete={
                                onDeletePage
                                  ? () => onDeletePage(page.id)
                                  : undefined
                              }
                            />
                          </li>
                        ))}

                        {subcategories.length === 0 &&
                        directPages.length === 0 ? (
                          <li className="px-2 py-1 text-[11px] text-muted">
                            Add a page or subcategory
                          </li>
                        ) : null}
                      </ul>
                    </CollapsibleContent>
                  </Collapsible>
                </li>
              );
            })}
          </ul>
        )}
      </nav>
    </aside>
  );
}
