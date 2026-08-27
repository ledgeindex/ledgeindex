"use client";

import type { LucideIcon } from "lucide-react";
import { X } from "lucide-react";
import { useCallback, useState, type ReactNode } from "react";
import {
  BuilderContextMenu,
  type BuilderContextMenuItem,
} from "@/components/source-builder/builder-context-menu";
import { cn } from "@/lib/utils";

export function BuilderPinCard({
  icon: Icon,
  title,
  onTitleChange,
  titlePlaceholder = "Title",
  headerTrailing,
  className,
  children,
  onRemove,
  removeLabel = "Remove",
}: {
  icon: LucideIcon;
  title: string;
  onTitleChange?: (title: string) => void;
  titlePlaceholder?: string;
  headerTrailing?: ReactNode;
  className?: string;
  children: ReactNode;
  onRemove?: () => void;
  removeLabel?: string;
}) {
  const [menuPoint, setMenuPoint] = useState<{ x: number; y: number } | null>(
    null,
  );

  const confirmRemove = useCallback(() => {
    if (!onRemove) return;
    const ok = window.confirm(`${removeLabel}?`);
    if (ok) onRemove();
  }, [onRemove, removeLabel]);

  const menuItems: BuilderContextMenuItem[] = onRemove
    ? [
        {
          id: "remove",
          label: removeLabel,
          destructive: true,
          onSelect: confirmRemove,
        },
      ]
    : [];

  return (
    <article
      className={cn(
        "group/pin flex min-h-0 w-full flex-col overflow-hidden rounded-lg border border-border/70 bg-[#FAFAFA] shadow-sm",
        "dark:border-white/[0.08] dark:bg-[#1A1A1A]",
        className,
      )}
      onContextMenu={(event) => {
        if (!onRemove) return;
        event.preventDefault();
        event.stopPropagation();
        setMenuPoint({ x: event.clientX, y: event.clientY });
      }}
    >
      <header className="flex shrink-0 items-center gap-2 rounded-t-lg border-b border-border/50 bg-surface-raised/80 px-3 py-2 dark:border-white/10">
        <Icon className="size-3.5 shrink-0 text-muted" aria-hidden />
        {onTitleChange ? (
          <input
            value={title}
            onChange={(event) => onTitleChange(event.target.value)}
            className="min-w-0 flex-1 bg-transparent text-xs font-medium text-foreground outline-none placeholder:text-muted"
            placeholder={titlePlaceholder}
            aria-label={titlePlaceholder}
          />
        ) : (
          <h3 className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
            {title}
          </h3>
        )}
        {headerTrailing ? (
          <div className="flex shrink-0 items-center gap-1">{headerTrailing}</div>
        ) : null}
        {onRemove ? (
          <button
            type="button"
            onClick={confirmRemove}
            className={cn(
              "inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted transition-all",
              "opacity-0 pointer-events-none group-hover/pin:opacity-100 group-hover/pin:pointer-events-auto",
              "hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-400",
              "focus-visible:opacity-100 focus-visible:pointer-events-auto focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border",
            )}
            aria-label={removeLabel}
            title={removeLabel}
          >
            <X className="size-3.5" />
          </button>
        ) : null}
      </header>
      <div className="min-h-0 flex-1">{children}</div>
      {menuItems.length > 0 ? (
        <BuilderContextMenu
          point={menuPoint}
          items={menuItems}
          onClose={() => setMenuPoint(null)}
        />
      ) : null}
    </article>
  );
}
