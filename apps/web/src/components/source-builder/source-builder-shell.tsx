"use client";

import { Code2, FileText, Plus } from "lucide-react";
import { BuilderCodePinCard } from "@/components/source-builder/builder-code-pin";
import { BuilderMarkdownPin } from "@/components/source-builder/builder-markdown-pin";
import { SourceBuilderStructureNav } from "@/components/source-builder/source-builder-structure-nav";
import {
  findActivePage,
  type BuilderPin,
  type SourceBuilderDraft,
} from "@/lib/source-builder-draft";
import { cn } from "@/lib/utils";

function PinStack({
  pins,
  onPinChange,
  onPinRemove,
}: {
  pins: BuilderPin[];
  onPinChange: (pin: BuilderPin) => void;
  onPinRemove: (pinId: string) => void;
}) {
  if (pins.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-surface-alt/50 px-4 py-10 text-center text-sm text-muted">
        This page has no pins yet. Add markdown or code content.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {pins.map((pin) =>
        pin.kind === "markdown" ? (
          <BuilderMarkdownPin
            key={pin.id}
            pin={pin}
            onChange={onPinChange}
            onRemove={() => onPinRemove(pin.id)}
          />
        ) : (
          <BuilderCodePinCard
            key={pin.id}
            pin={pin}
            onChange={onPinChange}
            onRemove={() => onPinRemove(pin.id)}
          />
        ),
      )}
    </div>
  );
}

function newId(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export function SourceBuilderShell({
  draft,
  onChange,
  className,
}: {
  draft: SourceBuilderDraft;
  onChange: (next: SourceBuilderDraft) => void;
  className?: string;
}) {
  const activePage = findActivePage(draft);

  function selectPage(pageId: string) {
    onChange({ ...draft, activePageId: pageId });
  }

  function addCategory() {
    const id = newId("cat");
    const subcategoryId = newId("sub");
    const pageId = newId("page");
    onChange({
      ...draft,
      categories: [
        ...draft.categories,
        {
          id,
          title: `Category ${draft.categories.length + 1}`,
          subcategories: [{ id: subcategoryId, title: "General" }],
        },
      ],
      pages: [
        ...draft.pages,
        {
          id: pageId,
          categoryId: id,
          subcategoryId,
          title: "New page",
          pins: [
            {
              id: newId("pin"),
              kind: "markdown",
              title: "Overview",
              markdown: "# New page\n\nWrite documentation here.",
            },
          ],
        },
      ],
      activePageId: pageId,
    });
  }

  function addSubcategory(categoryId: string) {
    const subcategoryId = newId("sub");
    const pageId = newId("page");
    const category = draft.categories.find((entry) => entry.id === categoryId);
    const nextIndex = (category?.subcategories?.length ?? 0) + 1;

    onChange({
      ...draft,
      categories: draft.categories.map((entry) =>
        entry.id === categoryId
          ? {
              ...entry,
              subcategories: [
                ...(entry.subcategories ?? []),
                {
                  id: subcategoryId,
                  title: `Subcategory ${nextIndex}`,
                },
              ],
            }
          : entry,
      ),
      pages: [
        ...draft.pages,
        {
          id: pageId,
          categoryId,
          subcategoryId,
          title: "New page",
          pins: [
            {
              id: newId("pin"),
              kind: "markdown",
              title: "Overview",
              markdown: "# New page\n\nWrite documentation here.",
            },
          ],
        },
      ],
      activePageId: pageId,
    });
  }

  function addPage(categoryId: string, subcategoryId?: string) {
    const pageId = newId("page");
    onChange({
      ...draft,
      pages: [
        ...draft.pages,
        {
          id: pageId,
          categoryId,
          subcategoryId: subcategoryId ?? null,
          title: "New page",
          pins: [
            {
              id: newId("pin"),
              kind: "markdown",
              title: "Overview",
              markdown: "# New page\n\nWrite documentation here.",
            },
          ],
        },
      ],
      activePageId: pageId,
    });
  }

  function addPin(kind: "markdown" | "code") {
    if (!activePage) return;
    const pinId = newId("pin");
    const pin: BuilderPin =
      kind === "markdown"
        ? {
            id: pinId,
            kind: "markdown",
            title: "Markdown",
            markdown: "### New section\n\nAdd your content.",
          }
        : {
            id: pinId,
            kind: "code",
            title: "Code",
            language: "typescript",
            filename: "example.ts",
            code: "// example\nconsole.log('hello');\n",
          };

    onChange({
      ...draft,
      pages: draft.pages.map((page) =>
        page.id === activePage.id
          ? { ...page, pins: [...page.pins, pin] }
          : page,
      ),
    });
  }

  function updatePin(nextPin: BuilderPin) {
    if (!activePage) return;
    onChange({
      ...draft,
      pages: draft.pages.map((page) =>
        page.id === activePage.id
          ? {
              ...page,
              pins: page.pins.map((pin) =>
                pin.id === nextPin.id ? nextPin : pin,
              ),
            }
          : page,
      ),
    });
  }

  function removePin(pinId: string) {
    if (!activePage) return;
    onChange({
      ...draft,
      pages: draft.pages.map((page) =>
        page.id === activePage.id
          ? { ...page, pins: page.pins.filter((pin) => pin.id !== pinId) }
          : page,
      ),
    });
  }

  function removePage(pageId: string) {
    const remaining = draft.pages.filter((page) => page.id !== pageId);
    const nextActive =
      draft.activePageId === pageId
        ? (remaining[0]?.id ?? null)
        : draft.activePageId;
    onChange({
      ...draft,
      pages: remaining,
      activePageId: nextActive,
    });
  }

  function renameActivePage(title: string) {
    if (!activePage) return;
    onChange({
      ...draft,
      pages: draft.pages.map((page) =>
        page.id === activePage.id ? { ...page, title } : page,
      ),
    });
  }

  return (
    <div
      className={cn(
        "flex min-h-[70vh] overflow-hidden rounded-xl border border-border bg-background shadow-sm",
        className,
      )}
    >
      <SourceBuilderStructureNav
        draft={draft}
        onSelectPage={selectPage}
        onAddCategory={addCategory}
        onAddSubcategory={addSubcategory}
        onAddPage={addPage}
        onDeletePage={removePage}
      />

      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-[0.62rem] font-semibold uppercase tracking-wide text-muted">
              Page
            </p>
            {activePage ? (
              <input
                value={activePage.title}
                onChange={(event) => renameActivePage(event.target.value)}
                className="w-full max-w-md bg-transparent text-base font-semibold text-foreground outline-none select-text"
                aria-label="Page title"
              />
            ) : (
              <h2 className="truncate text-base font-semibold text-foreground">
                Select a page
              </h2>
            )}
          </div>
          {activePage ? (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => addPin("markdown")}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-card-solid px-2.5 text-xs font-medium text-muted-strong transition-colors hover:bg-surface-raised hover:text-foreground"
              >
                <FileText className="size-3.5" />
                Markdown
              </button>
              <button
                type="button"
                onClick={() => addPin("code")}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-card-solid px-2.5 text-xs font-medium text-muted-strong transition-colors hover:bg-surface-raised hover:text-foreground"
              >
                <Code2 className="size-3.5" />
                Code
              </button>
              <span className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-[11px] text-muted">
                <Plus className="size-3" />
                Add pin
              </span>
            </div>
          ) : null}
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto bg-[#F0F0F0] p-4 dark:bg-[#0D0D0D]">
          {activePage ? (
            <PinStack
              pins={activePage.pins}
              onPinChange={updatePin}
              onPinRemove={removePin}
            />
          ) : (
            <div className="rounded-lg border border-dashed border-border bg-surface-alt/50 px-4 py-10 text-center text-sm text-muted">
              Add a category and page to start building this source.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
