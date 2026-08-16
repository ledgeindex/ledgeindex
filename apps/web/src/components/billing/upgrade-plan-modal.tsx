"use client";

import { useEffect, useState } from "react";
import { Crown, Loader2, Sparkles } from "lucide-react";
import { initializePaddle, type Paddle } from "@paddle/paddle-js";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuth } from "@/lib/auth-context";
import {
  getBillingConfig,
  type BillingConfigResponse,
} from "@/lib/billing-api";
import { cn } from "@/lib/utils";

type UpgradePlanModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  description?: string;
};

const PRO_FEATURES = [
  "Unlimited source sets",
  "Unlimited sources per set",
  "Full MCP access for grouped sources",
];

export function UpgradePlanModal({
  open,
  onOpenChange,
  title = "Upgrade to Pro",
  description = "Remove free-plan limits and group as many sources as you need for MCP clients.",
}: UpgradePlanModalProps) {
  const { user, profile } = useAuth();
  const [billing, setBilling] = useState<BillingConfigResponse | null>(null);
  const [loadingConfig, setLoadingConfig] = useState(false);
  const [isAnnual, setIsAnnual] = useState(false);
  const [paddle, setPaddle] = useState<Paddle>();
  const [priceLabel, setPriceLabel] = useState<string | null>(null);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const checkout = billing?.checkout ?? null;
  const isPro = profile?.plan === "pro";

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoadingConfig(true);
    setError(null);
    void getBillingConfig()
      .then((config) => {
        if (!cancelled) setBilling(config);
      })
      .catch(() => {
        if (!cancelled) {
          setError("Could not load billing configuration.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingConfig(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!checkout) return;
    let cancelled = false;
    void initializePaddle({
      environment: checkout.environment,
      token: checkout.clientToken,
    }).then((instance) => {
      if (!cancelled && instance) setPaddle(instance);
    });
    return () => {
      cancelled = true;
    };
  }, [checkout?.clientToken, checkout?.environment]);

  useEffect(() => {
    if (!paddle || !checkout) return;
    const priceId = isAnnual ? checkout.prices.annual : checkout.prices.monthly;
    let cancelled = false;
    void paddle
      .PricePreview({
        items: [{ priceId, quantity: 1 }],
      })
      .then((preview) => {
        if (cancelled) return;
        const line = preview.data.details.lineItems[0];
        const formatted = line?.formattedTotals?.total ?? line?.formattedUnitTotals?.total;
        setPriceLabel(formatted ?? null);
      })
      .catch(() => {
        if (!cancelled) setPriceLabel(null);
      });
    return () => {
      cancelled = true;
    };
  }, [paddle, checkout, isAnnual]);

  async function handleCheckout() {
    if (!paddle || !checkout || !user) return;
    setCheckoutLoading(true);
    setError(null);
    try {
      const priceId = isAnnual ? checkout.prices.annual : checkout.prices.monthly;
      paddle.Checkout.open({
        items: [{ priceId, quantity: 1 }],
        customer: user.email ? { email: user.email } : undefined,
        customData: { userId: user.uid },
      });
      onOpenChange(false);
    } catch {
      setError("Could not open checkout. Try again in a moment.");
    } finally {
      setCheckoutLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} className="w-[min(100%,32rem)]">
      <DialogHeader>
        <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-xl border border-amber-500/30 bg-amber-500/10">
          <Crown className="h-5 w-5 text-amber-500" />
        </div>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>

      <DialogContent className="space-y-4">
        {loadingConfig ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading plans…
          </div>
        ) : (
          <>
            <div className="rounded-xl border border-border bg-muted/20 p-4">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                <p className="font-medium">Pro</p>
                {isPro ? (
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
                    Current plan
                  </span>
                ) : null}
              </div>
              <ul className="mt-3 space-y-1.5 text-sm text-muted-foreground">
                {PRO_FEATURES.map((feature) => (
                  <li key={feature}>• {feature}</li>
                ))}
              </ul>
              {billing ? (
                <p className="mt-3 text-xs text-muted-foreground">
                  Free plan today: {billing.limits.maxSourceSets} source set, up
                  to {billing.limits.maxSourcesPerSet} sources per set.
                </p>
              ) : null}
            </div>

            {checkout && !isPro ? (
              <div className="flex items-center justify-between gap-3">
                <div className="inline-flex rounded-full border border-border p-1 text-xs">
                  <button
                    type="button"
                    className={cn(
                      "rounded-full px-3 py-1 transition-colors",
                      !isAnnual ? "bg-foreground text-background" : "text-muted-foreground",
                    )}
                    onClick={() => setIsAnnual(false)}
                  >
                    Monthly
                  </button>
                  <button
                    type="button"
                    className={cn(
                      "rounded-full px-3 py-1 transition-colors",
                      isAnnual ? "bg-foreground text-background" : "text-muted-foreground",
                    )}
                    onClick={() => setIsAnnual(true)}
                  >
                    Annual
                  </button>
                </div>
                {priceLabel ? (
                  <p className="text-sm font-medium">{priceLabel}</p>
                ) : null}
              </div>
            ) : null}

            {!isPro && !checkout && !loadingConfig ? (
              <p className="text-sm text-muted-foreground">
                Checkout is not configured on this server yet.
              </p>
            ) : null}

            {error ? (
              <p className="text-sm text-destructive">{error}</p>
            ) : null}
          </>
        )}
      </DialogContent>

      <DialogFooter>
        <Button variant="secondary" onClick={() => onOpenChange(false)}>
          {isPro ? "Close" : "Not now"}
        </Button>
        {!isPro && checkout ? (
          <Button disabled={checkoutLoading || !paddle} onClick={() => void handleCheckout()}>
            {checkoutLoading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : null}
            Upgrade to Pro
          </Button>
        ) : null}
      </DialogFooter>
    </Dialog>
  );
}
