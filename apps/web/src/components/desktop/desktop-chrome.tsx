"use client";

import { Settings } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { DesktopUpdateControl } from "@/components/desktop/desktop-update-control";
import { useLedgeIndexDesktop } from "@/lib/ledgeindex-desktop";
import { cn } from "@/lib/utils";

const SETTINGS_HREF = "/settings/providers";

/** Compact title-bar settings control (AutomationGhost-style). */
export function DesktopSettingsButton() {
  const pathname = usePathname();
  const active = pathname === SETTINGS_HREF || pathname.startsWith(`${SETTINGS_HREF}/`);

  return (
    <Link
      href={SETTINGS_HREF}
      className={cn(
        "inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md",
        "border border-border bg-card-solid/90 text-muted shadow-sm backdrop-blur-sm",
        "transition-colors [-webkit-app-region:no-drag]",
        "hover:border-foreground/15 hover:text-foreground",
        active && "border-foreground/15 bg-surface-raised text-foreground",
      )}
      title="Settings"
      aria-label="Settings"
      aria-current={active ? "page" : undefined}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <Settings className="size-[0.85rem]" aria-hidden />
    </Link>
  );
}

function MinimizeIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
      <rect x="1" y="4.5" width="8" height="1" fill="currentColor" />
    </svg>
  );
}

function MaximizeIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden fill="none">
      <rect
        x="1.5"
        y="1.5"
        width="7"
        height="7"
        stroke="currentColor"
        strokeWidth="1"
      />
    </svg>
  );
}

function RestoreIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden fill="none">
      <rect
        x="1.5"
        y="2.5"
        width="5.5"
        height="5.5"
        stroke="currentColor"
        strokeWidth="1"
      />
      <path
        d="M3.5 2.5V1.5h5.5v5.5h-1"
        stroke="currentColor"
        strokeWidth="1"
        fill="none"
      />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
      <path
        d="M2 2l6 6M8 2L2 8"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ControlButton({
  label,
  onClick,
  variant = "default",
  children,
}: {
  label: string;
  onClick: () => void;
  variant?: "default" | "close";
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex h-8 w-9 shrink-0 cursor-pointer items-center justify-center border-0 bg-transparent text-muted transition-colors [-webkit-app-region:no-drag]",
        variant === "close"
          ? "hover:bg-[#e81123] hover:text-white"
          : "hover:bg-surface-raised hover:text-foreground",
      )}
      onClick={onClick}
      aria-label={label}
      title={label}
    >
      {children}
    </button>
  );
}

export function DesktopDevButtons() {
  const desktop = useLedgeIndexDesktop();
  if (!desktop?.isDev) return null;

  return (
    <>
      <button
        type="button"
        className="inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md border border-border text-muted transition-colors [-webkit-app-region:no-drag] hover:bg-surface-raised hover:text-foreground"
        onClick={() => window.location.reload()}
        title="Reload window (dev)"
        aria-label="Reload window"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path
            d="M4 12a8 8 0 0 1 14.2-5M20 12a8 8 0 0 1-14.2 5"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
          <path
            d="M18 4v5h-5M6 20v-5h5"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <button
        type="button"
        className={cn(
          "inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md",
          "border border-amber-500/45 bg-amber-500/12 text-amber-900",
          "[-webkit-app-region:no-drag] hover:bg-amber-500/20 dark:text-amber-200",
        )}
        onClick={() => {
          void desktop.toggleDevTools();
        }}
        title="Toggle DevTools (Ctrl+Shift+I)"
        aria-label="Toggle DevTools"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path
            d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </>
  );
}

export function DesktopWindowControls() {
  const desktop = useLedgeIndexDesktop();
  const [isMaximized, setIsMaximized] = useState(false);
  const isMac = desktop?.platform === "darwin";

  useEffect(() => {
    if (!desktop) return;
    void desktop.isWindowMaximized().then(setIsMaximized);
    return desktop.onWindowMaximizedChange(setIsMaximized);
  }, [desktop]);

  const onMinimize = useCallback(() => {
    void desktop?.minimizeWindow();
  }, [desktop]);

  const onToggleMaximize = useCallback(() => {
    void desktop?.toggleMaximizeWindow().then(setIsMaximized);
  }, [desktop]);

  const onClose = useCallback(() => {
    void desktop?.closeWindow();
  }, [desktop]);

  if (!desktop || isMac) return null;

  return (
    <div className="inline-flex shrink-0 items-center [-webkit-app-region:no-drag]">
      <ControlButton label="Minimize" onClick={onMinimize}>
        <MinimizeIcon />
      </ControlButton>
      <ControlButton label={isMaximized ? "Restore" : "Maximize"} onClick={onToggleMaximize}>
        {isMaximized ? <RestoreIcon /> : <MaximizeIcon />}
      </ControlButton>
      <ControlButton label="Close" onClick={onClose} variant="close">
        <CloseIcon />
      </ControlButton>
    </div>
  );
}

/** Trailing chrome for the app header (settings + update + window controls). */
export function DesktopHeaderTrailing() {
  const desktop = useLedgeIndexDesktop();
  if (!desktop) return null;

  return (
    <div
      className="z-10 inline-flex shrink-0 items-center gap-1 [-webkit-app-region:no-drag]"
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <DesktopSettingsButton />
      <DesktopUpdateControl />
      <DesktopDevButtons />
      <DesktopWindowControls />
    </div>
  );
}
