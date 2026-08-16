"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Plus } from "lucide-react";
import { DashboardViewToggle } from "@/components/sources/dashboard-view-toggle";
import { KnowledgeSetScopeToggle } from "@/components/sources/knowledge-set-scope-toggle";
import { useDashboardToolbar } from "@/contexts/dashboard-toolbar-context";
import { usePlanBilling } from "@/contexts/plan-billing-context";
import { useAuth } from "@/lib/auth-context";
import {
  getAccountSourceLimits,
  type AccountSourceLimits,
} from "@/lib/billing-api";
import { cn } from "@/lib/utils";

export function AppHeaderDashboardControls() {
  const pathname = usePathname();
  const { user, isAdmin, planLimitsEnabled, profile } = useAuth();
  const { scope, viewMode, setScope, setViewMode } = useDashboardToolbar();
  const { openUpgradeModal, showPlanLimit } = usePlanBilling();
  const [sourceLimits, setSourceLimits] = useState<AccountSourceLimits | null>(
    null,
  );

  useEffect(() => {
    if (!planLimitsEnabled || !user) {
      setSourceLimits(null);
      return;
    }
    if (scope === "global" && !isAdmin) {
      setSourceLimits(null);
      return;
    }

    let cancelled = false;
    void getAccountSourceLimits(scope)
      .then((limits) => {
        if (!cancelled) setSourceLimits(limits);
      })
      .catch(() => {
        if (!cancelled) setSourceLimits(null);
      });
    return () => {
      cancelled = true;
    };
  }, [planLimitsEnabled, user, scope, isAdmin]);

  if (pathname !== "/dashboard") return null;

  const newCrawlHref =
    scope === "global" && isAdmin
      ? "/sources/web-crawl?scope=global&fresh=1"
      : "/sources/web-crawl?fresh=1";
  const newCrawlLabel =
    scope === "global" && isAdmin ? "New global set" : "New source";
  const scopeAllowsCreate =
    scope === "personal" || (scope === "global" && isAdmin);
  const atSourceLimit =
    planLimitsEnabled &&
    !isAdmin &&
    profile?.plan !== "pro" &&
    sourceLimits?.apply &&
    !sourceLimits.canCreate;

  return (
    <div className="ml-auto flex min-w-0 shrink items-center gap-1.5 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] sm:gap-2 [&::-webkit-scrollbar]:hidden">
      <KnowledgeSetScopeToggle
        value={scope}
        onChange={setScope}
        className="shrink-0 [&_button]:px-2 [&_button]:py-1 [&_button]:text-xs sm:[&_button]:px-3 sm:[&_button]:py-1.5 sm:[&_button]:text-sm"
      />
      <DashboardViewToggle value={viewMode} onChange={setViewMode} />
      {user && scopeAllowsCreate ? (
        atSourceLimit ? (
          <button
            type="button"
            onClick={() =>
              showPlanLimit(
                `Free plan allows ${sourceLimits?.maxSources ?? 3} ${
                  scope === "global" ? "public" : "personal"
                } sources.`,
              )
            }
            className={cn(
              "inline-flex h-8 shrink-0 cursor-not-allowed items-center gap-1.5 rounded-lg border border-border bg-muted/40 px-2.5 text-xs font-medium text-muted-foreground sm:h-9 sm:px-3 sm:text-sm",
            )}
          >
            <Plus className="size-3.5 sm:size-4" aria-hidden />
            <span className="hidden sm:inline">{newCrawlLabel}</span>
            <span className="sm:hidden">New</span>
          </button>
        ) : (
          <Link
            href={newCrawlHref}
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-border bg-card-solid px-2.5 text-xs font-medium text-foreground shadow-card transition-colors hover:bg-surface-raised sm:h-9 sm:px-3 sm:text-sm"
          >
            <Plus className="size-3.5 sm:size-4" aria-hidden />
            <span className="hidden sm:inline">{newCrawlLabel}</span>
            <span className="sm:hidden">New</span>
          </Link>
        )
      ) : null}
      {atSourceLimit ? (
        <button
          type="button"
          onClick={() => openUpgradeModal()}
          className="hidden text-xs font-medium text-accent hover:underline sm:inline"
        >
          Upgrade
        </button>
      ) : null}
    </div>
  );
}
