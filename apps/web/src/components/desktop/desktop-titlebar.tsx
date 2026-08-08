"use client";

import { useCallback } from "react";
import {
  DesktopDevButtons,
  DesktopWindowControls,
} from "@/components/desktop/desktop-chrome";
import { DesktopSidecarBadge } from "@/components/desktop/desktop-sidecar-badge";
import { DesktopUpdateControl } from "@/components/desktop/desktop-update-control";
import { useLedgeIndexDesktop } from "@/lib/ledgeindex-desktop";
import { cn } from "@/lib/utils";

/** Slim title bar for login / pages without AppShell. */
export function DesktopTitleBar({ title = "LedgeIndex" }: { title?: string }) {
  const desktop = useLedgeIndexDesktop();

  const onDoubleClick = useCallback(() => {
    void desktop?.toggleMaximizeWindow();
  }, [desktop]);

  if (!desktop) return null;

  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-[400] flex h-9 items-center gap-2 border-b border-border",
        "bg-card-solid/95 px-2 backdrop-blur-sm select-none [-webkit-app-region:drag]",
      )}
      onDoubleClick={onDoubleClick}
    >
      <p className="m-0 truncate px-2 text-xs font-semibold text-foreground">
        {title}
      </p>
      <div
        className="ml-2 [-webkit-app-region:no-drag]"
        onDoubleClick={(event) => event.stopPropagation()}
      >
        <DesktopSidecarBadge />
      </div>
      <div
        className="ml-auto inline-flex items-center gap-1 [-webkit-app-region:no-drag]"
        onDoubleClick={(event) => event.stopPropagation()}
      >
        <DesktopUpdateControl />
        <DesktopDevButtons />
        <DesktopWindowControls />
      </div>
    </header>
  );
}
