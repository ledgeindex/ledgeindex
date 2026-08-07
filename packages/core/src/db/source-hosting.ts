import { getWritablePostgresConnectionString } from "../vector/config.js";

/** Where the source index + metadata live. Independent of personal vs public scope. */
export type SourceHosting = "local" | "cloud";

export function isSourceHosting(value: unknown): value is SourceHosting {
  return value === "local" || value === "cloud";
}

/**
 * Cloud-only deployments own a writable Postgres (Cloud Run / prod).
 * Local/self-host/desktop sidecars use FileStore (+ optional cloud read-through).
 */
export function isLocalHostingDeployment(): boolean {
  return !getWritablePostgresConnectionString();
}

export function defaultHostingForScope(
  scope: "personal" | "global" | undefined | null,
): SourceHosting {
  if (scope === "global") return "cloud";
  return isLocalHostingDeployment() ? "local" : "cloud";
}

/**
 * Resolve effective hosting for a source row (legacy rows may omit the field).
 * Prefer explicit hosting; then scope/global; then vector backend hint; then deployment default.
 */
export function resolveSourceHosting(input: {
  hosting?: SourceHosting | null;
  scope?: "personal" | "global" | null;
  vectorBackend?: string | null;
}): SourceHosting {
  if (input.hosting === "local" || input.hosting === "cloud") {
    return input.hosting;
  }
  if (input.scope === "global") return "cloud";
  if (input.vectorBackend === "pgvector") return "cloud";
  if (input.vectorBackend === "libsql") return "local";
  return defaultHostingForScope(input.scope);
}

/** Normalize create-body hosting: global always cloud; prod always cloud. */
export function normalizeCreateHosting(input: {
  scope: "personal" | "global";
  hosting?: SourceHosting | null;
}): SourceHosting {
  if (input.scope === "global") return "cloud";
  if (!isLocalHostingDeployment()) return "cloud";
  if (input.hosting === "cloud" || input.hosting === "local") {
    return input.hosting;
  }
  return "local";
}
