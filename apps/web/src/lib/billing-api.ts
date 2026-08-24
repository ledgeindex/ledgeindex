import { auth } from "@/lib/firebase";
import {
  getLedgeIndexApiBaseUrl,
  KnowledgeIndexApiError,
} from "@/lib/ledgeindex-api";

export type PaddleCheckoutConfig = {
  clientToken: string;
  environment: "sandbox" | "production";
  prices: {
    monthly: string;
    annual: string;
  };
};

export type BillingConfigResponse = {
  enabled: boolean;
  plan: "free" | "pro";
  limits: {
    maxSourceSets: number;
    maxSourcesPerSet: number;
    maxSources: number;
    dailyMessages: number | null;
  };
  dailyMessageUsage: DailyMessageUsage | null;
  checkout: PaddleCheckoutConfig | null;
};

export type DailyMessageUsage = {
  apply: boolean;
  limit: number | null;
  used: number;
  remaining: number | null;
  resetsAt: string;
};

export async function getBillingConfig(): Promise<BillingConfigResponse> {
  const base = getLedgeIndexApiBaseUrl();
  const token = auth?.currentUser
    ? await auth.currentUser.getIdToken().catch(() => null)
    : null;

  const response = await fetch(`${base}/api/billing/config`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

  const data: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const payload = data as { error?: unknown; message?: unknown };
    const message =
      typeof payload.message === "string"
        ? payload.message
        : typeof payload.error === "string"
          ? payload.error
          : `Request failed (${response.status})`;
    throw new KnowledgeIndexApiError(message, response.status);
  }

  return data as BillingConfigResponse;
}

export type AccountSourceLimits = {
  apply: boolean;
  scope: "personal" | "global";
  maxSources: number | null;
  currentSourceCount: number;
  canCreate: boolean;
};

export async function getAccountSourceLimits(
  scope: "personal" | "global" = "personal",
): Promise<AccountSourceLimits> {
  const base = getLedgeIndexApiBaseUrl();
  const token = auth?.currentUser
    ? await auth.currentUser.getIdToken().catch(() => null)
    : null;

  const response = await fetch(
    `${base}/api/sources/limits?scope=${encodeURIComponent(scope)}`,
    {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    },
  );

  const data: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const payload = data as { error?: unknown; message?: unknown };
    const message =
      typeof payload.message === "string"
        ? payload.message
        : typeof payload.error === "string"
          ? payload.error
          : `Request failed (${response.status})`;
    throw new KnowledgeIndexApiError(message, response.status);
  }

  return (data as { limits: AccountSourceLimits }).limits;
}

function resolveCloudUsageApiBase(): string | null {
  const remote = process.env.NEXT_PUBLIC_LEDGEINDEX_REMOTE_API_URL?.trim()
    || process.env.NEXT_PUBLIC_KNOWLEDGEINDEX_REMOTE_API_URL?.trim();
  if (remote) return remote.replace(/\/$/, "");

  const current = getLedgeIndexApiBaseUrl().replace(/\/$/, "");
  if (!current) return null;
  if (/^https:\/\//i.test(current)) return current;
  if (/127\.0\.0\.1|localhost/i.test(current)) return null;
  return current;
}

/** Free-tier cloud chat budget — always reads from the hosted API, not local :3015. */
export async function getCloudDailyMessageUsage(): Promise<DailyMessageUsage | null> {
  const base = resolveCloudUsageApiBase();
  if (!base) return null;

  const token = auth?.currentUser
    ? await auth.currentUser.getIdToken().catch(() => null)
    : null;
  if (!token) return null;

  const headers = { Authorization: `Bearer ${token}` };

  const usageResponse = await fetch(`${base}/api/usage/cloud-messages`, {
    headers,
  });

  if (usageResponse.ok) {
    const data = (await usageResponse.json().catch(() => null)) as DailyMessageUsage | null;
    if (data && typeof data.used === "number" && data.limit != null) return data;
  }

  const billingResponse = await fetch(`${base}/api/billing/config`, { headers });
  if (!billingResponse.ok) return null;

  const billing = (await billingResponse.json().catch(() => null)) as
    | BillingConfigResponse
    | null;
  if (!billing) return null;

  if (billing.dailyMessageUsage?.apply) {
    return billing.dailyMessageUsage;
  }

  if (billing.limits.dailyMessages != null && billing.plan === "free") {
    const used = billing.dailyMessageUsage?.used ?? 0;
    const limit = billing.limits.dailyMessages;
    return {
      apply: true,
      limit,
      used,
      remaining: Math.max(0, limit - used),
      resetsAt: billing.dailyMessageUsage?.resetsAt ?? new Date().toISOString(),
    };
  }

  return null;
}
