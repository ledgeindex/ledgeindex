import { getAdminFirestore } from "../lib/firestore-admin.js";

export type UserPlan = "free" | "pro";

const planCache = new Map<string, { plan: UserPlan; expiresAt: number }>();
const CACHE_TTL_MS = 60_000;

export async function getUserPlan(userId: string): Promise<UserPlan> {
  const cached = planCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.plan;
  }

  const db = getAdminFirestore();
  if (!db) {
    return "free";
  }

  try {
    const doc = await db.collection("users").doc(userId).get();
    const plan =
      doc.exists && doc.data()?.plan === "pro" ? "pro" : "free";
    planCache.set(userId, { plan, expiresAt: Date.now() + CACHE_TTL_MS });
    return plan;
  } catch {
    return "free";
  }
}
