"use client";

import { useEffect, useRef, useState } from "react";
import { CreditCard, Crown, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePlanBilling } from "@/contexts/plan-billing-context";
import { useAuth } from "@/lib/auth-context";
import {
  getBillingConfig,
  type BillingConfigResponse,
} from "@/lib/billing-api";
import { KnowledgeIndexApiError } from "@/lib/ledgeindex-api";
import { useRouter } from "next/navigation";

export default function BillingPage() {
  const router = useRouter();
  const { profile, isAdmin, planLimitsEnabled, loading: authLoading } = useAuth();
  const { openUpgradeModal } = usePlanBilling();
  const [billing, setBilling] = useState<BillingConfigResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loadedRef = useRef(false);

  useEffect(() => {
    if (authLoading) return;
    if (!planLimitsEnabled) {
      router.replace("/dashboard");
    }
  }, [authLoading, planLimitsEnabled, router]);

  useEffect(() => {
    if (!planLimitsEnabled || loadedRef.current) return;
    loadedRef.current = true;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const config = await getBillingConfig();
        setBilling(config);
      } catch (err) {
        setError(
          err instanceof KnowledgeIndexApiError
            ? err.message
            : "Failed to load billing",
        );
      } finally {
        setLoading(false);
      }
    })();
  }, [planLimitsEnabled]);

  if (authLoading || !planLimitsEnabled) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Loading…
      </div>
    );
  }

  const currentPlan = isAdmin ? "admin" : (profile?.plan ?? billing?.plan ?? "free");
  const isPro = currentPlan === "pro" || isAdmin;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Billing</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage your LedgeIndex plan and source-set limits.
        </p>
      </div>

      {error ? (
        <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading billing…
        </div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-xl border border-border p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm text-muted-foreground">Current plan</p>
                <p className="mt-1 flex items-center gap-2 text-xl font-semibold capitalize">
                  {isAdmin ? (
                    <Crown className="h-5 w-5 text-amber-500" />
                  ) : (
                    <CreditCard className="h-5 w-5 text-primary" />
                  )}
                  {isAdmin ? "Admin" : currentPlan}
                </p>
              </div>
              {!isPro ? (
                <Button onClick={() => openUpgradeModal()}>Upgrade to Pro</Button>
              ) : null}
            </div>
          </div>

          {billing && !isPro ? (
            <div className="rounded-xl border border-border bg-muted/20 p-5 text-sm text-muted-foreground">
              <p className="font-medium text-foreground">Free plan includes</p>
              <ul className="mt-2 space-y-1">
                <li>• Up to {billing.limits.maxSources} personal sources</li>
                <li>• {billing.limits.maxSourceSets} source set</li>
                <li>• Up to {billing.limits.maxSourcesPerSet} sources per set</li>
                {billing.limits.dailyMessages != null ? (
                  <li>
                    •{" "}
                    {billing.dailyMessageUsage?.apply
                      ? `${billing.dailyMessageUsage.remaining ?? 0} of ${billing.limits.dailyMessages} chat messages left today (UTC)`
                      : `${billing.limits.dailyMessages} chat messages per day (UTC)`}
                  </li>
                ) : null}
              </ul>
            </div>
          ) : null}

          {isPro && !isAdmin ? (
            <p className="text-sm text-muted-foreground">
              You are on Pro — no source-set limits apply to your account.
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
