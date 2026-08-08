"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

export type BuilderContextMenuItem = {
  id: string;
  label: string;
  destructive?: boolean;
  disabled?: boolean;
  onSelect: () => void;
};

export function BuilderContextMenu({
  point,
  items,
  onClose,
}: {
  point: { x: number; y: number } | null;
  items: BuilderContextMenuItem[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!point) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    function onPointer(event: MouseEvent) {
      if (ref.current?.contains(event.target as Node)) return;
      onClose();
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onPointer);
    window.addEventListener("scroll", onClose, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onPointer);
      window.removeEventListener("scroll", onClose, true);
    };
  }, [point, onClose]);

  if (!point || typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={ref}
      role="menu"
      className="fixed z-[400] min-w-[9.5rem] overflow-hidden rounded-lg border border-border bg-card-solid py-1 shadow-card"
      style={{ left: point.x, top: point.y }}
    >
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="menuitem"
          disabled={item.disabled}
          onClick={() => {
            if (item.disabled) return;
            item.onSelect();
            onClose();
          }}
          className={cn(
            "flex w-full px-3 py-1.5 text-left text-xs font-medium transition-colors disabled:opacity-40",
            item.destructive
              ? "text-red-600 hover:bg-red-500/10 dark:text-red-400"
              : "text-foreground hover:bg-surface-raised",
          )}
        >
          {item.label}
        </button>
      ))}
    </div>,
    document.body,
  );
}
