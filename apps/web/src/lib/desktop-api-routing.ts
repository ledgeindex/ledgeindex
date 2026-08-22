"use client";

import {
  getLedgeIndexApiBaseUrl,
  resolveRemoteApiBaseUrl,
  setLedgeIndexApiBaseUrl,
} from "@ledgeindex/client";
import type { KnowledgeSetScope } from "@/components/sources/knowledge-set-scope-toggle";
import { getLedgeIndexDesktop } from "@/lib/ledgeindex-desktop";

const LOCAL_FALLBACK = "http://127.0.0.1:3015";
const WEB_LOCAL_FALLBACK = "http://localhost:3010";

function isProductionBuild(): boolean {
  return process.env.NODE_ENV === "production";
}

/** Local desktop sidecar (:3015). Do not fall back to a hosted API URL. */
export function resolveDesktopLocalApiUrl(): string {
  const fromEnv = process.env.NEXT_PUBLIC_LEDGEINDEX_LOCAL_API_URL?.trim();
  return fromEnv ? fromEnv.replace(/\/$/, "") : LOCAL_FALLBACK;
}

/**
 * Hosted API for Public (global) + cloud personal sources.
 * Uses @ledgeindex/client resolver so Next.js inlined NEXT_PUBLIC_* values apply
 * (dynamic process.env[name] is not inlined in the browser bundle).
 */
export function resolveDesktopRemoteApiUrl(): string | null {
  return resolveRemoteApiBaseUrl();
}

/** Default local API for the web app in dev (usually :3010). */
export function resolveWebLocalApiUrl(): string {
  const ledge = process.env.NEXT_PUBLIC_LEDGEINDEX_API_URL?.trim();
  const legacy = process.env.NEXT_PUBLIC_KNOWLEDGEINDEX_API_URL?.trim();
  const fromEnv = ledge || legacy;
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  if (isProductionBuild()) return "";
  return WEB_LOCAL_FALLBACK;
}

/** Chat / source-scoped API base: remote for cloud/global, else active local base. */
export function resolveApiBaseForHosting(input: {
  scope: KnowledgeSetScope;
  hosting: "local" | "cloud";
}): string {
  if (input.scope === "global" || input.hosting === "cloud") {
    const remote = resolveRemoteApiBaseUrl();
    if (remote) return remote;
  }
  const desktop = Boolean(getLedgeIndexDesktop());
  return desktop ? resolveDesktopLocalApiUrl() : resolveWebLocalApiUrl();
}

/** Point the shared client at local vs remote depending on Personal/Public scope. */
export function syncDesktopApiBaseForScope(scope: KnowledgeSetScope): void {
  if (!getLedgeIndexDesktop()) return;
  if (scope === "global") {
    const remote = resolveRemoteApiBaseUrl();
    if (remote) setLedgeIndexApiBaseUrl(remote);
    return;
  }
  setLedgeIndexApiBaseUrl(resolveDesktopLocalApiUrl());
}

/**
 * Route create/index/chat traffic by hosting.
 * Cloud sources (personal account-bound or public) go to the remote/cloud API.
 * Local personal sources stay on the local API / desktop sidecar.
 */
export function syncApiBaseForHosting(input: {
  scope: KnowledgeSetScope;
  hosting: "local" | "cloud";
}): void {
  setLedgeIndexApiBaseUrl(resolveApiBaseForHosting(input));
}

/** Website widget CRUD always targets the hosted cloud API (not local :3015). */
export function syncWidgetCloudApi(): void {
  const remote = resolveRemoteApiBaseUrl();
  if (remote) {
    setLedgeIndexApiBaseUrl(remote);
    return;
  }
  const webLocal = resolveWebLocalApiUrl();
  if (webLocal && !/localhost|127\.0\.0\.1/i.test(webLocal)) {
    setLedgeIndexApiBaseUrl(webLocal);
  }
}

/** Current API base after sync — for debugging chat routing. */
export function getSyncedApiBaseUrl(): string {
  return getLedgeIndexApiBaseUrl();
}
