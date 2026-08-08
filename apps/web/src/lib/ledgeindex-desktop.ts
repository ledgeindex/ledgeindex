"use client";

import { useEffect, useState } from "react";

export type SidecarStatus = "idle" | "starting" | "ready" | "error";

export type SidecarHealth = {
  status: SidecarStatus;
  managedStatus: SidecarStatus;
  reachable: boolean;
  origin: string;
  port: number;
};

export type DesktopProviderId = "openai" | "google" | "deepseek";

export type DesktopProviderKeyInput = Partial<Record<DesktopProviderId, string>>;

export type DesktopProviderKeyStatus = Record<DesktopProviderId, boolean>;

export type DesktopUpdateEvent = {
  type: string;
  info?: {
    version?: string;
    releaseName?: string;
    releaseNotes?: string | string[] | null;
    releaseDate?: string | null;
  };
  progress?: { percent?: number };
  error?: string;
};

export type DesktopUpdateFeedConfig = {
  provider?: "github";
  owner?: string;
  repo?: string;
  private?: boolean;
};

export type LedgeIndexDesktopApi = {
  isDesktop: true;
  isDev: boolean;
  platform: string;
  minimizeWindow: () => Promise<void>;
  toggleMaximizeWindow: () => Promise<boolean>;
  closeWindow: () => Promise<void>;
  isWindowMaximized: () => Promise<boolean>;
  toggleDevTools: () => Promise<boolean>;
  openDevTools: () => void;
  onWindowMaximizedChange: (
    callback: (maximized: boolean) => void,
  ) => () => void;
  getSidecarHealth?: () => Promise<SidecarHealth>;
  restartSidecar?: () => Promise<SidecarHealth>;
  getApiOrigin?: () => Promise<string>;
  getProviderKeyStatus?: () => Promise<DesktopProviderKeyStatus>;
  saveProviderKeys?: (
    keys: DesktopProviderKeyInput,
  ) => Promise<DesktopProviderKeyStatus>;
  getAppPreferences?: () => Promise<{
    startInTray: boolean;
    closeToTray: boolean;
  }>;
  setAppPreferences?: (
    patch: Partial<{ startInTray: boolean; closeToTray: boolean }>,
  ) => Promise<{ startInTray: boolean; closeToTray: boolean }>;
  getAppVersion?: () => Promise<string>;
  /** Packaged desktop: Google OAuth loopback → Firebase ID token. */
  oauthGoogleSignIn?: () => Promise<string>;
  checkForUpdates?: (
    config?: DesktopUpdateFeedConfig,
  ) => Promise<{ ok: boolean; version?: string | null; error?: string }>;
  downloadUpdate?: () => Promise<{ ok: boolean; error?: string }>;
  installUpdate?: () => Promise<void>;
  onUpdateEvent?: (callback: (payload: DesktopUpdateEvent) => void) => () => void;
};

export function getLedgeIndexDesktop(): LedgeIndexDesktopApi | null {
  if (typeof window === "undefined") return null;
  const w = window as Window & {
    ledgeindexDesktop?: LedgeIndexDesktopApi;
    __LEDGEINDEX_DESKTOP__?: boolean;
  };
  if (w.ledgeindexDesktop?.isDesktop) return w.ledgeindexDesktop;
  return null;
}

export function useLedgeIndexDesktop(): LedgeIndexDesktopApi | null {
  // Sync read on first paint — null→effect→set was bouncing desktop-only routes.
  const [desktop, setDesktop] = useState<LedgeIndexDesktopApi | null>(() =>
    getLedgeIndexDesktop(),
  );

  useEffect(() => {
    const read = () => setDesktop(getLedgeIndexDesktop());
    read();
    const id = window.setInterval(read, 250);
    return () => window.clearInterval(id);
  }, []);

  return desktop;
}
