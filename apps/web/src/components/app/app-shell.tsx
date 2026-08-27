"use client";

import { Menu } from "lucide-react";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AppHeaderDashboardControls } from "@/components/app/app-header-dashboard-controls";
import { AppHeaderSourceChatControls } from "@/components/app/app-header-source-chat-controls";
import { AppHeaderSourceBuilderControls } from "@/components/app/app-header-source-builder-controls";
import { AppHeaderWebCrawlControls } from "@/components/app/app-header-web-crawl-controls";
import { AppHeaderIndexedNotice } from "@/components/app/app-header-indexed-notice";
import { AppSidebar } from "@/components/app/app-sidebar";
import { DesktopHeaderTrailing } from "@/components/desktop/desktop-chrome";
import { DesktopSidecarBadge } from "@/components/desktop/desktop-sidecar-badge";
import { ThemeToggle } from "@/components/theme-toggle-slot";
import {
  MobileAppSidebarProvider,
  useMobileAppSidebar,
} from "@/contexts/mobile-app-sidebar-context";
import { AppOnboardingGate } from "@/components/onboarding/app-onboarding";
import { useLedgeIndexDesktop } from "@/lib/ledgeindex-desktop";
import { cn } from "@/lib/utils";

export function MobileMenuButton({ className }: { className?: string }) {
  const sidebar = useMobileAppSidebar();

  return (
    <button
      type="button"
      onClick={() => sidebar?.toggle()}
      className={cn(
        "inline-flex size-10 shrink-0 items-center justify-center rounded-lg border border-border text-muted transition-colors hover:bg-surface-raised hover:text-foreground [-webkit-app-region:no-drag]",
        className,
      )}
      aria-label="Open menu"
    >
      <Menu className="size-5" />
    </button>
  );
}

function AppSidebarLayer({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!isOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen]);

  if (!mounted) return null;

  return createPortal(
    <>
      {isOpen ? (
        <button
          type="button"
          className="fixed inset-0 z-[405] bg-black/40 [-webkit-app-region:no-drag]"
          aria-label="Close menu"
          onClick={onClose}
        />
      ) : null}

      <AppSidebar
        className={cn(
          "fixed inset-y-0 left-0 z-[410] h-dvh w-[15.5rem] max-w-[85vw] transition-[transform,visibility,opacity] duration-300 [-webkit-app-region:no-drag]",
          isOpen
            ? "visible translate-x-0 opacity-100"
            : "invisible pointer-events-none -translate-x-full opacity-0",
        )}
        onNavigate={onClose}
      />
    </>,
    document.body,
  );
}

function AppShellInner({ children }: { children: React.ReactNode }) {
  const sidebar = useMobileAppSidebar();
  const pathname = usePathname();
  const desktop = useLedgeIndexDesktop();
  const isOpen = sidebar?.isOpen ?? false;
  const isWebCrawl = pathname.startsWith("/sources/web-crawl");
  const isWebCrawlDesktop = isWebCrawl && Boolean(desktop);
  const showAppHeader = !isWebCrawl || Boolean(desktop);
  const lockViewport =
    isWebCrawl ||
    pathname === "/chat" ||
    pathname === "/admin/source-updater" ||
    /^\/sources\/[^/]+\/chat$/.test(pathname);
  const isSourceChat = /^\/sources\/[^/]+\/chat$/.test(pathname);
  const isSourceBuilderDetail = /^\/sources\/builder\/[^/]+$/.test(pathname);
  const useCustomHeader =
    isSourceChat || isSourceBuilderDetail || isWebCrawlDesktop;
  const headerUsesDragRegion = desktop && !isOpen;

  const onHeaderDoubleClick = useCallback(() => {
    void desktop?.toggleMaximizeWindow();
  }, [desktop]);

  return (
    <div className="flex h-dvh max-h-dvh overflow-hidden bg-surface-alt">
      <AppSidebarLayer
        isOpen={isOpen}
        onClose={() => sidebar?.setOpen(false)}
      />

      <div
        className={cn(
          "relative z-0 flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden",
          // While the drawer is open, kill header drag so Electron doesn't steal
          // clicks from the overlay sidebar (nav links).
          desktop && isOpen && "[&_header]:[-webkit-app-region:no-drag]",
        )}
      >
        {showAppHeader ? (
          <header
            className={cn(
              "relative z-10 flex h-12 shrink-0 items-center gap-2 border-b border-border bg-card-solid/90 px-3 pt-[env(safe-area-inset-top)] backdrop-blur-sm sm:gap-3",
              headerUsesDragRegion &&
                "select-none [-webkit-app-region:drag]",
              desktop && isOpen && "select-none [-webkit-app-region:no-drag]",
            )}
            onDoubleClick={
              desktop && !isOpen ? onHeaderDoubleClick : undefined
            }
          >
            <div
              className={cn(
                "z-10 inline-flex min-w-0 shrink-0 items-center gap-2 sm:gap-3",
                desktop && "[-webkit-app-region:no-drag]",
              )}
              onDoubleClick={(event) => event.stopPropagation()}
            >
              <MobileMenuButton />
              {desktop ? <DesktopSidecarBadge /> : null}
              <AppHeaderIndexedNotice />
            </div>
            {useCustomHeader ? (
              <div className="z-10 flex min-h-0 min-w-0 flex-1 items-center">
                {isSourceChat ? <AppHeaderSourceChatControls /> : null}
                {isSourceBuilderDetail ? (
                  <AppHeaderSourceBuilderControls />
                ) : null}
                {isWebCrawlDesktop ? <AppHeaderWebCrawlControls /> : null}
              </div>
            ) : (
              <div
                className={cn(
                  "z-10 flex min-w-0 flex-1 items-center justify-end",
                  desktop && "min-h-full",
                )}
              >
                <div
                  className={cn(desktop && "[-webkit-app-region:no-drag]")}
                  onDoubleClick={(event) => event.stopPropagation()}
                >
                  <AppHeaderDashboardControls />
                </div>
              </div>
            )}
            <div
              className={cn(
                "z-10 inline-flex shrink-0 items-center gap-1.5",
                desktop && "[-webkit-app-region:no-drag]",
              )}
              onDoubleClick={(event) => event.stopPropagation()}
            >
              <ThemeToggle />
            </div>
            <DesktopHeaderTrailing />
          </header>
        ) : null}
        <main
          className={cn(
            "flex min-h-0 flex-1 flex-col overflow-x-hidden",
            lockViewport ? "overflow-hidden" : "overflow-y-auto",
          )}
        >
          {children}
        </main>
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <AppOnboardingGate>
      <MobileAppSidebarProvider>
        <AppShellInner>{children}</AppShellInner>
      </MobileAppSidebarProvider>
    </AppOnboardingGate>
  );
}
