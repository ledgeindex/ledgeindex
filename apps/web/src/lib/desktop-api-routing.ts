"use client";

import { setLedgeIndexApiBaseUrl } from "@ledgeindex/client";
import type { KnowledgeSetScope } from "@/components/sources/knowledge-set-scope-toggle";
import { getLedgeIndexDesktop } from "@/lib/ledgeindex-desktop";

const LOCAL_FALLBACK = "http://127.0.0.1:3015";
const WEB_LOCAL_FALLBACK = "http://localhost:3010";

function envUrl(name: string): string | undefined {
  const value = (process.env as Record<string, string | undefined>)[name];
  return typeof value === "string" && value.trim()
    ? value.trim().replace(/\/$/, "")
    : undefined;
}

function isLoopbackApiUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return true;
  }
}

function isProductionBuild(): boolean {
  return process.env.NODE_ENV === "production";
}

/** Local desktop sidecar (:3015). Do not fall back to a hosted API URL. */
export function resolveDesktopLocalApiUrl(): string {
  return envUrl("NEXT_PUBLIC_LEDGEINDEX_LOCAL_API_URL") || LOCAL_FALLBACK;
}

/**
 * Hosted / web API for Public (global) sources on desktop.
 * Null when unset — OSS local-only must not invent a cloud origin.
 */
export function resolveDesktopRemoteApiUrl(): string | null {
  const candidates = [
    envUrl("NEXT_PUBLIC_LEDGEINDEX_REMOTE_API_URL"),
    envUrl("NEXT_PUBLIC_KNOWLEDGEINDEX_REMOTE_API_URL"),
    envUrl("LEDGEINDEX_REMOTE_API_URL"),
  ];
  for (const url of candidates) {
    if (url && !isLoopbackApiUrl(url)) return url;
  }
  return null;
}

/** Default local API for the web app in dev (usually :3010). */
export function resolveWebLocalApiUrl(): string {
  const fromEnv =
    envUrl("NEXT_PUBLIC_LEDGEINDEX_API_URL") ||
    envUrl("NEXT_PUBLIC_KNOWLEDGEINDEX_API_URL");
  if (fromEnv) return fromEnv;
  if (isProductionBuild()) return "";
  return WEB_LOCAL_FALLBACK;
}

/** Point the shared client at local vs remote depending on Personal/Public scope. */
export function syncDesktopApiBaseForScope(scope: KnowledgeSetScope): void {
  if (!getLedgeIndexDesktop()) return;
  if (scope === "global") {
    const remote = resolveDesktopRemoteApiUrl();
    if (remote) setLedgeIndexApiBaseUrl(remote);
    return;
  }
  setLedgeIndexApiBaseUrl(resolveDesktopLocalApiUrl());
}

/**
 * Route create/index traffic by hosting.
 * Cloud sources (personal account-bound or public) go to the remote/cloud API.
 * Local personal sources stay on the local API / desktop sidecar.
 */
export function syncApiBaseForHosting(input: {
  scope: KnowledgeSetScope;
  hosting: "local" | "cloud";
}): void {
  const desktop = Boolean(getLedgeIndexDesktop());
  if (input.scope === "global" || input.hosting === "cloud") {
    const remote = resolveDesktopRemoteApiUrl();
    if (remote) {
      setLedgeIndexApiBaseUrl(remote);
      return;
    }
  }
  setLedgeIndexApiBaseUrl(
    desktop ? resolveDesktopLocalApiUrl() : resolveWebLocalApiUrl(),
  );
}
