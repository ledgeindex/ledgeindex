import { getAdminFirestore } from "../lib/firestore-admin.js";
import { isLocalHostingDeployment } from "../db/types.js";
import { isPlanLimitsEnabled } from "./source-set-limits.js";
import { getUserPlan } from "./user-plan.js";
import { getUserRole, isAdminRole } from "./user-role.js";

/** Default free-tier chat/ask budget per UTC day when plan limits are enabled. */
export const FREE_DAILY_MESSAGES_DEFAULT = 25;

export type DailyMessageUsage = {
  apply: boolean;
  limit: number | null;
  used: number;
  remaining: number | null;
  resetsAt: string;
};

export class DailyMessageLimitError extends Error {
  code = "DAILY_MESSAGE_LIMIT" as const;
  limit: number;
  used: number;
  resetsAt: string;

  constructor(limit: number, used: number, resetsAt: string) {
    super(
      `Daily message limit reached (${used}/${limit}). Resets at midnight UTC. Upgrade to Pro for unlimited chat.`,
    );
    this.name = "DailyMessageLimitError";
    this.limit = limit;
    this.used = used;
    this.resetsAt = resetsAt;
  }
}

type MemoryBucket = { dayKey: string; count: number };

const memoryBuckets = new Map<string, MemoryBucket>();

export function getFreeDailyMessageLimit(): number {
  const raw = process.env.LEDGEINDEX_FREE_DAILY_MESSAGES?.trim();
  if (!raw) return FREE_DAILY_MESSAGES_DEFAULT;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return FREE_DAILY_MESSAGES_DEFAULT;
  return parsed;
}

export function utcDayKey(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export function nextUtcMidnightIso(from = new Date()): string {
  const next = new Date(
    Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate() + 1),
  );
  return next.toISOString();
}

function usageDocId(dayKey: string): string {
  return `chat_${dayKey}`;
}

/** Free-tier daily chat budget applies on hosted cloud API only (not local desktop worker). */
export function isCloudDailyMessageMeteringEnabled(): boolean {
  return isPlanLimitsEnabled() && !isLocalHostingDeployment();
}

async function appliesToUser(userId: string): Promise<boolean> {
  if (!isCloudDailyMessageMeteringEnabled()) return false;
  if (!userId.trim()) return false;

  const localDesktop =
    process.env.LEDGEINDEX_LOCAL_USER_ID?.trim() || "ledgeindex-desktop-local";
  if (!process.env.LEDGEINDEX_AUTH_REQUIRED?.trim() && userId === localDesktop) {
    return false;
  }

  const role = await getUserRole(userId);
  if (isAdminRole(role)) return false;

  const plan = await getUserPlan(userId);
  return plan !== "pro";
}

function readMemoryUsage(userId: string, dayKey: string): number {
  const bucket = memoryBuckets.get(userId);
  if (!bucket || bucket.dayKey !== dayKey) return 0;
  return bucket.count;
}

function writeMemoryUsage(userId: string, dayKey: string, count: number): void {
  memoryBuckets.set(userId, { dayKey, count });
  if (memoryBuckets.size > 5_000) {
    memoryBuckets.clear();
  }
}

async function readFirestoreCount(
  userId: string,
  dayKey: string,
): Promise<number | null> {
  const db = getAdminFirestore();
  if (!db) return null;

  const snap = await db
    .collection("users")
    .doc(userId)
    .collection("usage")
    .doc(usageDocId(dayKey))
    .get();

  if (!snap.exists) return 0;
  const count = snap.data()?.count;
  return typeof count === "number" && count >= 0 ? count : 0;
}

async function incrementFirestoreCount(
  userId: string,
  dayKey: string,
  limit: number,
): Promise<number> {
  const db = getAdminFirestore();
  if (!db) {
    throw new Error("Firestore is not configured");
  }

  const ref = db
    .collection("users")
    .doc(userId)
    .collection("usage")
    .doc(usageDocId(dayKey));

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const current =
      snap.exists && typeof snap.data()?.count === "number"
        ? Math.max(0, snap.data()!.count as number)
        : 0;
    if (current >= limit) {
      throw new DailyMessageLimitError(limit, current, nextUtcMidnightIso());
    }
    const next = current + 1;
    tx.set(
      ref,
      {
        count: next,
        dayKey,
        updatedAt: new Date().toISOString(),
      },
      { merge: true },
    );
    return next;
  });
}

export async function getDailyMessageUsage(
  userId: string,
): Promise<DailyMessageUsage> {
  const resetsAt = nextUtcMidnightIso();
  const dayKey = utcDayKey();

  if (!isCloudDailyMessageMeteringEnabled()) {
    return {
      apply: false,
      limit: null,
      used: 0,
      remaining: null,
      resetsAt,
    };
  }

  const limit = getFreeDailyMessageLimit();
  const firestoreCount = await readFirestoreCount(userId, dayKey);
  const used = firestoreCount ?? readMemoryUsage(userId, dayKey);

  if (!(await appliesToUser(userId))) {
    return {
      apply: false,
      limit,
      used,
      remaining: null,
      resetsAt,
    };
  }

  return {
    apply: true,
    limit,
    used,
    remaining: Math.max(0, limit - used),
    resetsAt,
  };
}

/** Throws when the free daily budget is exhausted; otherwise increments usage. */
export async function takeDailyMessage(userId: string): Promise<DailyMessageUsage> {
  const dayKey = utcDayKey();
  const resetsAt = nextUtcMidnightIso();

  if (!(await appliesToUser(userId))) {
    return {
      apply: false,
      limit: null,
      used: 0,
      remaining: null,
      resetsAt,
    };
  }

  const limit = getFreeDailyMessageLimit();

  try {
    const used = await incrementFirestoreCount(userId, dayKey, limit);
    return {
      apply: true,
      limit,
      used,
      remaining: Math.max(0, limit - used),
      resetsAt,
    };
  } catch (error) {
    if (error instanceof DailyMessageLimitError) throw error;
    if (error instanceof Error && /Firestore is not configured/i.test(error.message)) {
      const current = readMemoryUsage(userId, dayKey);
      if (current >= limit) {
        throw new DailyMessageLimitError(limit, current, resetsAt);
      }
      const used = current + 1;
      writeMemoryUsage(userId, dayKey, used);
      return {
        apply: true,
        limit,
        used,
        remaining: Math.max(0, limit - used),
        resetsAt,
      };
    }
    throw error;
  }
}

export function routeCountsAsDailyMessage(method: string, url: string): boolean {
  if (method !== "POST") return false;
  const path = url.split("?")[0] ?? url;
  if (path.startsWith("/chat/")) return true;
  return /^\/api\/sources\/[^/]+\/ask$/.test(path);
}
