"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Check, ChevronDown, Database, Info, Save } from "lucide-react";
import { useOptionalSourceBuilderToolbar } from "@/contexts/source-builder-toolbar-context";
import { getLedgeIndexDesktop } from "@/lib/ledgeindex-desktop";
import { cn } from "@/lib/utils";

const BUILDER_DETAIL_PATH = /^\/sources\/builder\/[^/]+$/;

export function AppHeaderSourceBuilderControls() {
  const pathname = usePathname();
  const toolbar = useOptionalSourceBuilderToolbar();
  const header = toolbar?.header ?? null;
  const isDesktop = Boolean(getLedgeIndexDesktop());
  const [saveOpen, setSaveOpen] = useState(false);

  if (!BUILDER_DETAIL_PATH.test(pathname) || !header) {
    return null;
  }

  const {
    name,
    dirty,
    justSaved,
    draftId,
    versions,
    aboutOpen,
    aboutBusy,
    onRename,
    onVersionChange,
    onSaveUpdate,
    onSaveAsNew,
    onIndex,
    onAboutToggle,
  } = header;

  return (
    <>
      <div
        className={cn(
          "flex min-w-0 shrink items-center gap-2 sm:gap-3",
          isDesktop && "[-webkit-app-region:no-drag]",
        )}
        onDoubleClick={(event) => event.stopPropagation()}
      >
        <Link
          href="/sources/builder"
          className="shrink-0 text-xs text-muted transition-colors hover:text-foreground"
        >
          <span className="sm:hidden">←</span>
          <span className="hidden sm:inline">← Builder</span>
        </Link>
        <div className="min-w-0">
          <p className="hidden text-[0.5625rem] font-semibold uppercase tracking-wide text-muted sm:block">
            Source builder
            {dirty ? " · unsaved" : ""}
          </p>
          <input
            value={name}
            onChange={(event) => onRename(event.target.value)}
            className="w-full max-w-[10rem] truncate bg-transparent text-sm font-semibold text-foreground outline-none placeholder:text-muted sm:max-w-[16rem] sm:text-base"
            placeholder="Source name"
            aria-label="Source name"
          />
        </div>
      </div>

      <div className="min-h-full min-w-[1.5rem] flex-1 self-stretch" aria-hidden />

      <div
        className={cn(
          "ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2",
          isDesktop && "[-webkit-app-region:no-drag]",
        )}
        onDoubleClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          onClick={onAboutToggle}
          disabled={aboutBusy}
          aria-pressed={aboutOpen}
          className={cn(
            "inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors disabled:opacity-50",
            aboutOpen
              ? "border-foreground/20 bg-foreground text-background"
              : "border-border bg-card-solid text-muted hover:bg-surface-raised hover:text-foreground",
          )}
        >
          <Info className="size-3.5" aria-hidden />
          <span className="hidden sm:inline">
            {aboutBusy ? "…" : "About"}
          </span>
        </button>

        <label className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-card-solid px-2">
          <span className="sr-only">Version</span>
          <select
            value={draftId}
            onChange={(event) => onVersionChange(event.target.value)}
            className="max-w-[7rem] bg-transparent font-mono text-xs font-medium text-foreground outline-none sm:max-w-[9rem]"
            aria-label="Documentation version"
          >
            {versions.map((version) => (
              <option key={version.id} value={version.id}>
                {version.versionLabel}
                {version.linkedSourceId ? " · indexed" : ""}
              </option>
            ))}
          </select>
        </label>

        <div className="relative">
          <div className="flex">
            <button
              type="button"
              onClick={() => {
                setSaveOpen(false);
                onSaveUpdate();
              }}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-l-lg border bg-card-solid px-2.5 text-xs font-medium transition-colors",
                justSaved
                  ? "border-emerald-500/40 text-emerald-600 dark:text-emerald-400"
                  : dirty
                    ? "border-border text-foreground hover:bg-surface-raised"
                    : "border-border text-muted hover:bg-surface-raised hover:text-foreground",
              )}
            >
              {justSaved ? (
                <Check className="size-3.5" aria-hidden />
              ) : (
                <Save className="size-3.5" aria-hidden />
              )}
              <span className="hidden sm:inline">
                {justSaved ? "Saved" : "Save"}
              </span>
            </button>
            <button
              type="button"
              onClick={() => setSaveOpen((open) => !open)}
              className="inline-flex h-8 items-center rounded-r-lg border border-l-0 border-border bg-card-solid px-1.5 text-muted transition-colors hover:bg-surface-raised hover:text-foreground"
              aria-haspopup="menu"
              aria-expanded={saveOpen}
              aria-label="Save options"
            >
              <ChevronDown className="size-3.5" />
            </button>
          </div>
          {saveOpen ? (
            <>
              <button
                type="button"
                className="fixed inset-0 z-10 cursor-default"
                aria-label="Close save menu"
                onClick={() => setSaveOpen(false)}
              />
              <div
                role="menu"
                className="absolute right-0 z-20 mt-1 w-52 overflow-hidden rounded-lg border border-border bg-card-solid py-1 shadow-card"
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setSaveOpen(false);
                    onSaveUpdate();
                  }}
                  className="flex w-full flex-col px-3 py-2 text-left hover:bg-surface-raised"
                >
                  <span className="text-xs font-medium text-foreground">
                    Update current version
                  </span>
                  <span className="text-[0.65rem] text-muted">
                    Overwrite this version
                  </span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setSaveOpen(false);
                    onSaveAsNew();
                  }}
                  className="flex w-full flex-col px-3 py-2 text-left hover:bg-surface-raised"
                >
                  <span className="text-xs font-medium text-foreground">
                    Save as new version
                  </span>
                  <span className="text-[0.65rem] text-muted">
                    Keep current, continue on next
                  </span>
                </button>
              </div>
            </>
          ) : null}
        </div>

        <button
          type="button"
          onClick={onIndex}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-foreground px-2.5 text-xs font-medium text-background transition-opacity hover:opacity-90"
        >
          <Database className="size-3.5" />
          <span className="hidden sm:inline">Index</span>
        </button>
      </div>
    </>
  );
}
