/**
 * Early-access endpoints. Kept app-local rather than in @ledgeindex/client: they are
 * internal admin plumbing, not part of the public SDK surface.
 */
import { authenticatedFetch, getLedgeIndexApiBaseUrl } from "@ledgeindex/client";
import { resolveDesktopRemoteApiUrl } from "@/lib/desktop-api-routing";
import { getLedgeIndexDesktop } from "@/lib/ledgeindex-desktop";
import type { AccessStatus } from "@/lib/user-profile";

export type AdminUserAccess = {
  uid: string;
  role: "user" | "admin";
  status: AccessStatus;
  email: string | null;
  displayName: string | null;
  requestedAt: string | null;
  reviewedAt: string | null;
  reviewedBy: string | null;
};

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const detail = await response
      .json()
      .then((body: { error?: unknown }) =>
        typeof body.error === "string" ? body.error : null,
      )
      .catch(() => null);
    throw new Error(detail ?? `Request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
}

/**
 * Approval lives with the cloud account, so desktop must not send these to its local
 * sidecar — that one runs without Firebase and would report everyone as approved.
 */
function url(path: string): string {
  const remote = getLedgeIndexDesktop() ? resolveDesktopRemoteApiUrl() : null;
  const base = remote ?? getLedgeIndexApiBaseUrl();
  return `${base.replace(/\/$/, "")}${path}`;
}

export async function requestAccess(note?: string): Promise<AccessStatus> {
  const response = await authenticatedFetch(url("/api/access-request"), {
    method: "POST",
    body: JSON.stringify(note?.trim() ? { note: note.trim() } : {}),
  });
  const body = await readJson<{ accessStatus: AccessStatus }>(response);
  return body.accessStatus;
}

export async function listAdminUsers(): Promise<AdminUserAccess[]> {
  const response = await authenticatedFetch(url("/api/admin/users"));
  const body = await readJson<{ users: AdminUserAccess[] }>(response);
  return body.users;
}

export async function setUserAccess(
  uid: string,
  status: "approved" | "denied",
): Promise<void> {
  const response = await authenticatedFetch(
    url(`/api/admin/users/${encodeURIComponent(uid)}/access`),
    { method: "POST", body: JSON.stringify({ status }) },
  );
  await readJson(response);
}
