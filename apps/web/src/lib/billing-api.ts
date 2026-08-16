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
  };
  checkout: PaddleCheckoutConfig | null;
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
