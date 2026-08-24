import {
  FREE_MAX_SOURCES,
  FREE_MAX_SOURCE_SETS,
  isPlanLimitsEnabled,
} from "./source-set-limits.js";
import {
  getFreeDailyMessageLimit,
  isCloudDailyMessageMeteringEnabled,
  type DailyMessageUsage,
} from "./daily-message-limit.js";

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

export function getPaddleCheckoutConfig(): PaddleCheckoutConfig | null {
  if (!isPlanLimitsEnabled()) return null;

  const clientToken = process.env.LEDGEINDEX_PADDLE_CLIENT_TOKEN?.trim();
  const monthly = process.env.LEDGEINDEX_PRO_PRICE_MONTHLY?.trim();
  const annual = process.env.LEDGEINDEX_PRO_PRICE_ANNUAL?.trim();
  if (!clientToken || !monthly) return null;

  const envRaw = process.env.LEDGEINDEX_PADDLE_ENVIRONMENT?.trim().toLowerCase();
  const environment: "sandbox" | "production" =
    envRaw === "production" ? "production" : "sandbox";

  return {
    clientToken,
    environment,
    prices: {
      monthly,
      annual: annual ?? monthly,
    },
  };
}

export function getBillingConfig(
  plan: "free" | "pro",
  dailyMessageUsage: DailyMessageUsage | null = null,
): BillingConfigResponse {
  const dailyMessages =
    plan === "pro" || !isCloudDailyMessageMeteringEnabled()
      ? null
      : getFreeDailyMessageLimit();

  return {
    enabled: isPlanLimitsEnabled(),
    plan,
    limits: {
      maxSourceSets: FREE_MAX_SOURCE_SETS,
      maxSourcesPerSet: FREE_MAX_SOURCES,
      maxSources: FREE_MAX_SOURCES,
      dailyMessages,
    },
    dailyMessageUsage,
    checkout: getPaddleCheckoutConfig(),
  };
}
