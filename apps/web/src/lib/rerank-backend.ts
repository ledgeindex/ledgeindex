import type { SourceHosting, SourceScope } from "@ledgeindex/client";

export const RERANK_BACKENDS = [
  {
    id: "cohere-auto",
    label: "Cloud Auto",
    description:
      "Cohere 3.5 first; escalate to Cohere 4 when rankings look ambiguous",
    adminOnly: false,
  },
  {
    id: "cohere",
    label: "Cohere 3.5",
    description: "Cohere rerank-v3.5 API",
    adminOnly: true,
  },
  {
    id: "cohere-v4-fast",
    label: "Cohere 4",
    description: "Cohere rerank-v4.0-fast",
    adminOnly: true,
  },
  {
    id: "local-auto",
    label: "Local Auto",
    description:
      "MiniLM L6 first; escalate top hits to L12 when ambiguous",
    adminOnly: false,
  },
  {
    id: "local-mini",
    label: "Local MiniLM L6",
    description: "Xenova/ms-marco-MiniLM-L-6-v2 — fast EN CE",
    adminOnly: true,
  },
  {
    id: "local-mini-l12",
    label: "Local MiniLM L12",
    description: "Xenova/ms-marco-MiniLM-L-12-v2 — stronger EN CE",
    adminOnly: true,
  },
  {
    id: "vector",
    label: "Vector",
    description: "No cross-encoder rerank — vector similarity only (speed test)",
    adminOnly: true,
  },
] as const;

export type LedgeIndexRerankBackendId =
  (typeof RERANK_BACKENDS)[number]["id"];

/** Default for everyone — Cloud Auto. Fine-grained backends stay admin-only. */
export const DEFAULT_RERANK_BACKEND_ID: LedgeIndexRerankBackendId =
  "cohere-auto";
export const NON_ADMIN_RERANK_BACKEND_ID: LedgeIndexRerankBackendId =
  "cohere-auto";

/** Cloud-hosted sources: fixed fast path — Cohere auto, no picker. */
export const CLOUD_SOURCE_RERANK_BACKEND_ID: LedgeIndexRerankBackendId =
  "cohere-auto";

/** Local path for the composer Local/Cloud toggle. */
export const LOCAL_RERANK_BACKEND_ID: LedgeIndexRerankBackendId = "local-auto";

export function isCloudRerankBackend(
  backend: LedgeIndexRerankBackendId,
): boolean {
  return (
    backend === "cohere-auto" ||
    backend === "cohere" ||
    backend === "cohere-v4-fast"
  );
}

export function resolveSourceHosting(input: {
  hosting?: SourceHosting | null;
  scope?: SourceScope | null;
}): SourceHosting {
  if (input.hosting === "local" || input.hosting === "cloud") {
    return input.hosting;
  }
  return input.scope === "global" ? "cloud" : "local";
}

/** Cloud badge when the index is cloud-hosted (public or personal-on-cloud). */
export function isCloudHostedSource(input: {
  hosting?: SourceHosting | null;
  scope?: SourceScope | null;
}): boolean {
  return resolveSourceHosting(input) === "cloud";
}

/** @deprecated Prefer isCloudHostedSource — scope alone is not hosting. */
export function isCloudSourceScope(
  scope: "personal" | "global" | undefined | null,
): boolean {
  return scope === "global";
}

export function rerankBackendsForUser(isAdmin: boolean) {
  return RERANK_BACKENDS.filter(
    (backend) => isAdmin || !backend.adminOnly,
  );
}

export function defaultRerankBackendForUser(
  isAdmin: boolean,
): LedgeIndexRerankBackendId {
  return isAdmin ? DEFAULT_RERANK_BACKEND_ID : NON_ADMIN_RERANK_BACKEND_ID;
}

export function resolveAllowedRerankBackend(
  backend: LedgeIndexRerankBackendId | undefined,
  isAdmin: boolean,
): LedgeIndexRerankBackendId {
  const allowed = rerankBackendsForUser(isAdmin);
  if (backend && allowed.some((entry) => entry.id === backend)) {
    return backend;
  }
  return defaultRerankBackendForUser(isAdmin);
}
