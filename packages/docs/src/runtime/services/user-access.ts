import { getAdminFirestore } from "../lib/firestore-admin.js";
import { getUserRole, isAdminRole } from "./user-role.js";

export type AccessStatus = "pending" | "approved" | "denied";

export type UserAccess = {
  status: AccessStatus;
  email: string | null;
  displayName: string | null;
  requestedAt: string | null;
  reviewedAt: string | null;
  reviewedBy: string | null;
};

const accessCache = new Map<string, { status: AccessStatus; expiresAt: number }>();
const CACHE_TTL_MS = 30_000;

function toIso(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string") return value;
  const candidate = value as { toDate?: () => Date };
  if (typeof candidate.toDate === "function") {
    return candidate.toDate().toISOString();
  }
  return null;
}

function normalizeStatus(value: unknown): AccessStatus | null {
  return value === "pending" || value === "approved" || value === "denied"
    ? value
    : null;
}

/**
 * Approval state for a signed-in user.
 *
 * Missing / unknown accessStatus means pending — invite-only by default.
 * Admins are always approved so an empty allowlist can't lock everyone out.
 */
export async function getUserAccessStatus(userId: string): Promise<AccessStatus> {
  const cached = accessCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) return cached.status;

  const role = await getUserRole(userId);
  if (isAdminRole(role)) return "approved";

  const db = getAdminFirestore();
  // No Firestore in local/desktop mode — don't gate local sidecars.
  if (!db) return "approved";

  let status: AccessStatus = "pending";
  try {
    const doc = await db.collection("users").doc(userId).get();
    if (doc.exists) {
      status = normalizeStatus(doc.data()?.accessStatus) ?? "pending";
    }
  } catch {
    return "pending";
  }

  accessCache.set(userId, { status, expiresAt: Date.now() + CACHE_TTL_MS });
  return status;
}

export function forgetUserAccessStatus(userId: string): void {
  accessCache.delete(userId);
}

/** Records that the user asked to be let in; admins see this in the approval panel. */
export async function requestUserAccess(
  userId: string,
  note: string | null,
): Promise<AccessStatus> {
  const db = getAdminFirestore();
  if (!db) return "approved";

  const ref = db.collection("users").doc(userId);
  const doc = await ref.get();
  const current = normalizeStatus(doc.data()?.accessStatus);
  if (current === "approved" || current === "denied") return current;

  await ref.set(
    {
      accessStatus: "pending",
      accessRequestedAt: new Date().toISOString(),
      ...(note ? { accessRequestNote: note.slice(0, 500) } : {}),
    },
    { merge: true },
  );
  forgetUserAccessStatus(userId);
  return "pending";
}

export async function setUserAccessStatus(
  userId: string,
  status: AccessStatus,
  reviewedBy: string,
): Promise<void> {
  const db = getAdminFirestore();
  if (!db) return;

  await db
    .collection("users")
    .doc(userId)
    .set(
      {
        accessStatus: status,
        accessReviewedAt: new Date().toISOString(),
        accessReviewedBy: reviewedBy,
      },
      { merge: true },
    );
  forgetUserAccessStatus(userId);
}

export async function listUserAccess(): Promise<
  Array<UserAccess & { uid: string; role: string }>
> {
  const db = getAdminFirestore();
  if (!db) return [];

  const snapshot = await db.collection("users").get();
  return snapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      uid: doc.id,
      role: data.role === "admin" ? "admin" : "user",
      status: normalizeStatus(data.accessStatus) ?? "pending",
      email: typeof data.email === "string" ? data.email : null,
      displayName:
        typeof data.displayName === "string" ? data.displayName : null,
      requestedAt: toIso(data.accessRequestedAt),
      reviewedAt: toIso(data.accessReviewedAt),
      reviewedBy:
        typeof data.accessReviewedBy === "string" ? data.accessReviewedBy : null,
    };
  });
}
