import { getAdminFirestore } from "../lib/firestore-admin.js";

export type UserRole = "user" | "admin";

const roleCache = new Map<string, { role: UserRole; expiresAt: number }>();
const CACHE_TTL_MS = 60_000;

function adminUidsFromEnv(): Set<string> {
  const raw = process.env.LEDGEINDEX_ADMIN_UIDS?.trim();
  if (!raw) return new Set();
  return new Set(
    raw
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

export async function getUserRole(userId: string): Promise<UserRole> {
  if (adminUidsFromEnv().has(userId)) {
    return "admin";
  }

  const cached = roleCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.role;
  }

  const db = getAdminFirestore();
  if (!db) {
    return "user";
  }

  try {
    const doc = await db.collection("users").doc(userId).get();
    const role = doc.exists && doc.data()?.role === "admin" ? "admin" : "user";
    roleCache.set(userId, { role, expiresAt: Date.now() + CACHE_TTL_MS });
    return role;
  } catch {
    return "user";
  }
}

export function isAdminRole(role: UserRole): boolean {
  return role === "admin";
}
