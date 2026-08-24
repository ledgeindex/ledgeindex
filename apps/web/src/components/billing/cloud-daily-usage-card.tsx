"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePlanBilling } from "@/contexts/plan-billing-context";
import { useAuth } from "@/lib/auth-context";
import {
  getCloudDailyMessageUsage,
  type DailyMessageUsage,
} from "@/lib/billing-api";
import { cn } from "@/lib/utils";

const FREE_DAILY_MESSAGES_DEFAULT = 25;

function nextUtcMidnightIso(): string {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
  ).toISOString();
}

function placeholderUsage(limit = FREE_DAILY_MESSAGES_DEFAULT): DailyMessageUsage {
  return {
    apply: true,
    limit,
    used: 0,
    remaining: limit,
    resetsAt: nextUtcMidnightIso(),
  };
}

export function CloudDailyUsageCard({ className }: { className?: string }) {
  const { user, loading: authLoading } = useAuth();
  const { openUpgradeModal } = usePlanBilling();
  const [usage, setUsage] = useState<DailyMessageUsage | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading || !user) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        const next = await getCloudDailyMessageUsage();
        if (!cancelled) setUsage(next);
      } catch {
        if (!cancelled) setUsage(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [authLoading, user]);

  if (authLoading || !user) return null;

  if (loading) {
    return (
      <div
        className={cn(
          "flex items-center gap-2 text-sm text-muted-foreground",
          className,
        )}
      >
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading…
      </div>
    );
  }

  const resolved =
    usage && usage.limit != null && typeof usage.used === "number"
      ? usage
      : placeholderUsage();

  const limit = resolved.limit ?? FREE_DAILY_MESSAGES_DEFAULT;
  const used = resolved.used;
  const remaining = resolved.remaining ?? Math.max(0, limit - used);
  const ratio = limit > 0 ? Math.min(1, used / limit) : 0;
  const atLimit = usage?.apply === true && remaining <= 0;

  return (
    <div className={cn("space-y-4", className)}>
      <div className="flex items-end justify-between gap-4">
        <p className="text-3xl font-semibold tabular-nums tracking-tight text-foreground">
          {used}
          <span className="text-xl font-normal text-muted-foreground">
            {" "}
            / {limit}
          </span>
        </p>
        {atLimit ? (
          <Button size="sm" onClick={() => openUpgradeModal()}>
            Upgrade
          </Button>
        ) : null}
      </div>

      <div
        className="h-2 overflow-hidden rounded-full bg-border"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-valuenow={used}
        aria-label="Cloud messages used today"
      >
        <div
          className={cn(
            "h-full rounded-full transition-all",
            atLimit ? "bg-amber-500" : "bg-accent",
          )}
          style={{ width: `${Math.round(ratio * 100)}%` }}
        />
      </div>

      <p className="text-sm text-muted-foreground">
        Cloud messages today · {remaining} left (all cloud chat)
      </p>
    </div>
  );
}
