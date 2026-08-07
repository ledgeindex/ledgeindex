"use client";

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SourcePathOption } from "@/lib/source-paths";

type ScopeEntry = { id: string; label: string };

export function buildPathScopeEntries(
  pathOptions: readonly SourcePathOption[],
): ScopeEntry[] {
  if (pathOptions.length < 2) return [];
  return [
    { id: "all", label: "All" },
    ...pathOptions.map((path) => ({ id: path.id, label: path.label })),
  ];
}

type PathScopePillProps = {
  pathOptions: readonly SourcePathOption[];
  pathScope: string;
  onPathScopeChange: (scope: string) => void;
  disabled?: boolean;
  className?: string;
};

function ScopeOptionButton({
  entry,
  selected,
  onSelect,
}: {
  entry: ScopeEntry;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      className={cn(
        "flex w-full items-center rounded-lg px-2.5 py-1.5 text-left text-[0.75rem]",
        selected
          ? "bg-foreground/10 font-medium text-foreground"
          : "text-foreground hover:bg-surface-raised",
      )}
      onClick={onSelect}
    >
      {entry.label}
    </button>
  );
}

/** Horizontal path pills for the retrieval side panel. */
export function PathScopePills({
  pathOptions,
  pathScope,
  onPathScopeChange,
  disabled = false,
  className,
}: PathScopePillProps) {
  const entries = useMemo(
    () => buildPathScopeEntries(pathOptions),
    [pathOptions],
  );

  if (entries.length === 0) return null;

  return (
    <div className={cn("space-y-1.5", className)}>
      <p className="font-mono text-[0.5rem] font-semibold tracking-[0.1em] text-muted uppercase">
        Paths
      </p>
      <div
        role="listbox"
        aria-label="Documentation path"
        className="flex flex-wrap gap-1.5"
      >
        {entries.map((entry) => {
          const selected = entry.id === pathScope;
          return (
            <button
              key={entry.id}
              type="button"
              role="option"
              aria-selected={selected}
              disabled={disabled}
              onClick={() => onPathScopeChange(entry.id)}
              className={cn(
                "inline-flex h-7 items-center rounded-full border px-2.5 text-[0.68rem] font-medium transition-colors",
                "disabled:cursor-not-allowed disabled:opacity-50",
                selected
                  ? "border-foreground/20 bg-foreground/10 text-foreground"
                  : "border-border bg-card-solid text-muted hover:border-foreground/15 hover:text-foreground",
              )}
            >
              {entry.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Compact All / per-path picker for the composer (non–side-panel layouts). */
export function PathScopePill({
  pathOptions,
  pathScope,
  onPathScopeChange,
  disabled = false,
  className,
}: PathScopePillProps) {
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ left: number; bottom: number } | null>(
    null,
  );
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const pathEntries = useMemo(
    () => buildPathScopeEntries(pathOptions),
    [pathOptions],
  );

  const visible = pathEntries.length >= 2;
  const activeLabel =
    pathEntries.find((entry) => entry.id === pathScope)?.label ?? "All";

  useLayoutEffect(() => {
    if (!open || !visible) {
      setMenuPos(null);
      return;
    }
    const update = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      setMenuPos({
        left: Math.max(8, rect.left),
        bottom: Math.max(8, window.innerHeight - rect.top + 6),
      });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, visible]);

  useEffect(() => {
    if (!open || !visible) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        triggerRef.current?.contains(target) ||
        menuRef.current?.contains(target)
      ) {
        return;
      }
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, visible]);

  if (!visible) return null;

  return (
    <div className={cn("relative shrink-0", className)}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={menuId}
        aria-label="Documentation path scope"
        title={`Ask in: ${activeLabel}`}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "inline-flex h-7 max-w-[11rem] min-w-0 items-center gap-1.5 rounded-full border px-2.5 pr-2",
          "border-sky-500/55 bg-transparent text-[0.68rem] font-medium text-foreground",
          "hover:border-sky-500/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/35",
          "disabled:cursor-not-allowed disabled:opacity-50",
        )}
      >
        <span className="text-muted">Path</span>
        <span className="min-w-0 truncate">{activeLabel}</span>
        <ChevronDown
          className={cn(
            "size-3.5 shrink-0 text-muted transition-transform",
            open && "rotate-180",
          )}
          aria-hidden
        />
      </button>

      {open && menuPos
        ? createPortal(
            <div
              ref={menuRef}
              id={menuId}
              role="listbox"
              aria-label="Documentation path"
              style={{ left: menuPos.left, bottom: menuPos.bottom }}
              className={cn(
                "fixed z-[1000] min-w-[10rem] overflow-hidden rounded-xl border border-border",
                "bg-card-solid p-1 shadow-card",
              )}
              onMouseDown={(event) => event.stopPropagation()}
            >
              <div className="px-1 pb-1">
                <p className="px-2 py-1.5 font-mono text-[0.5625rem] font-semibold tracking-[0.1em] text-muted uppercase">
                  Paths
                </p>
                {pathEntries.map((entry) => (
                  <ScopeOptionButton
                    key={entry.id}
                    entry={entry}
                    selected={entry.id === pathScope}
                    onSelect={() => {
                      onPathScopeChange(entry.id);
                      setOpen(false);
                    }}
                  />
                ))}
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
