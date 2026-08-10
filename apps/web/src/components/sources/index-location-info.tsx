"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Info } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Compact (i) control explaining Just me/Public vs Local/Cloud.
 * Panel is portaled — parent cards use overflow:hidden and would clip a local popover.
 */
export function IndexLocationInfo({
  hosting = "local",
  scope = "personal",
  className,
}: {
  hosting?: "local" | "cloud";
  scope?: "personal" | "global";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [panelStyle, setPanelStyle] = useState<CSSProperties>({});
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useEffect(() => {
    setMounted(true);
  }, []);

  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return;

    function place() {
      const button = buttonRef.current;
      if (!button) return;
      const rect = button.getBoundingClientRect();
      const panelWidth = 280;
      const gap = 6;
      const left = Math.min(
        Math.max(8, rect.right - panelWidth),
        window.innerWidth - panelWidth - 8,
      );
      const top = rect.bottom + gap;
      setPanelStyle({
        position: "fixed",
        top,
        left,
        width: panelWidth,
        zIndex: 80,
      });
    }

    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (buttonRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      setOpen(false);
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const where =
    hosting === "cloud"
      ? "LedgeIndex cloud"
      : "this device";
  const visibility = scope === "global" ? "everyone (public)" : "only you";

  return (
    <div className={cn("shrink-0", className)}>
      <button
        ref={buttonRef}
        type="button"
        aria-label="About storage and visibility"
        aria-expanded={open}
        aria-controls={panelId}
        title="About storage and visibility"
        onClick={() => setOpen((current) => !current)}
        className={cn(
          "inline-flex size-7 items-center justify-center rounded-md border border-border bg-card-solid text-muted transition-colors",
          "hover:bg-surface-raised hover:text-foreground",
          open && "border-foreground/20 text-foreground",
        )}
      >
        <Info className="size-3.5" aria-hidden />
      </button>

      {mounted && open
        ? createPortal(
            <div
              ref={panelRef}
              id={panelId}
              role="dialog"
              aria-label="Source location and visibility"
              style={panelStyle}
              className="rounded-xl border border-border bg-card-solid p-3 shadow-card"
            >
              <p className="text-[0.6875rem] font-semibold tracking-wide text-foreground uppercase">
                Storage and visibility
              </p>
              <div className="mt-2 space-y-2.5 text-xs leading-5 text-muted">
                <div>
                  <p className="font-medium text-foreground">Storage</p>
                  <p className="mt-0.5">
                    Local or Cloud: where the docs are processed and kept. Right
                    now:{" "}
                    <span className="font-medium text-foreground">{where}</span>.
                  </p>
                </div>
                <div>
                  <p className="font-medium text-foreground">Visibility</p>
                  <p className="mt-0.5">
                    Just me or Public: who can see this source. Right now:{" "}
                    <span className="font-medium text-foreground">
                      {visibility}
                    </span>
                    .
                  </p>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
