"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { DashboardViewToggle } from "@/components/sources/dashboard-view-toggle";
import { KnowledgeSetScopeToggle } from "@/components/sources/knowledge-set-scope-toggle";
import { useDashboardToolbar } from "@/contexts/dashboard-toolbar-context";
import { useAuth } from "@/lib/auth-context";

export function AppHeaderDashboardControls() {
  const pathname = usePathname();
  const { user, isAdmin } = useAuth();
  const { scope, viewMode, setScope, setViewMode } = useDashboardToolbar();

  if (pathname !== "/dashboard") return null;

  const newCrawlHref =
    scope === "global" && isAdmin
      ? "/sources/web-crawl?scope=global&fresh=1"
      : "/sources/web-crawl?fresh=1";
  const newCrawlLabel =
    scope === "global" && isAdmin ? "New global set" : "New source";

  return (
    <div className="ml-auto flex min-w-0 shrink items-center gap-1.5 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] sm:gap-2 [&::-webkit-scrollbar]:hidden">
      <KnowledgeSetScopeToggle
        value={scope}
        onChange={setScope}
        className="shrink-0 [&_button]:px-2 [&_button]:py-1 [&_button]:text-xs sm:[&_button]:px-3 sm:[&_button]:py-1.5 sm:[&_button]:text-sm"
      />
      <DashboardViewToggle value={viewMode} onChange={setViewMode} />
      {user ? (
        <Link
          href={newCrawlHref}
          className="inline-flex h-8 shrink-0 items-center rounded-lg border border-border bg-card-solid px-2.5 text-xs font-medium text-foreground shadow-card transition-colors hover:bg-surface-raised sm:h-9 sm:px-3 sm:text-sm"
        >
          <span className="hidden sm:inline">{newCrawlLabel}</span>
          <span className="sm:hidden">New</span>
        </Link>
      ) : null}
    </div>
  );
}
