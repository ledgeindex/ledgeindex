import type { LucideIcon } from "lucide-react";
import {
  CreditCard,
  BookOpen,
  BarChart3,
  KeyRound,
  Layers,
  LayoutDashboard,
  MessageSquare,
  Puzzle,
  Plug,
  Plus,
  RefreshCw,
  Settings,
} from "lucide-react";

export type AppNavItem = {
  id: string;
  label: string;
  href: string;
  icon: LucideIcon;
  adminOnly?: boolean;
  /** Primary action — visually separated from the rest of the nav. */
  emphasis?: boolean;
  /** Only show when hosted billing / plan limits are enabled on the API. */
  requiresPlanLimits?: boolean;
  /** Only show inside @ledgeindex/desktop (Electron). */
  desktopOnly?: boolean;
};

export const APP_NAV_ITEMS: AppNavItem[] = [
  {
    id: "new-crawl",
    label: "Add source",
    href: "/sources/web-crawl?fresh=1",
    icon: Plus,
    emphasis: true,
  },
  {
    id: "explore-chat",
    label: "Playground",
    href: "/chat",
    icon: MessageSquare,
  },
  {
    id: "website-widget",
    label: "Website widget",
    href: "/widget",
    icon: Puzzle,
  },
  {
    id: "dashboard",
    label: "Sources",
    href: "/dashboard",
    icon: LayoutDashboard,
  },
  {
    id: "source-builder",
    label: "Source builder",
    href: "/sources/builder",
    icon: BookOpen,
  },
  {
    id: "source-sets",
    label: "Source sets",
    href: "/source-sets",
    icon: Layers,
  },
  {
    id: "mcp",
    label: "MCP",
    href: "/mcp/connect",
    icon: Plug,
  },
  {
    id: "api-keys",
    label: "API keys",
    href: "/api-keys",
    icon: KeyRound,
  },
  {
    id: "usage",
    label: "Usage",
    href: "/usage",
    icon: BarChart3,
  },
  {
    id: "billing",
    label: "Billing",
    href: "/billing",
    icon: CreditCard,
    requiresPlanLimits: true,
  },
  {
    id: "provider-keys",
    label: "Settings",
    href: "/settings/providers",
    icon: Settings,
  },
  {
    id: "admin-source-updater",
    label: "Source updater",
    href: "/admin/source-updater",
    icon: RefreshCw,
    adminOnly: true,
  },
];

export function isAppNavActive(
  pathname: string,
  href: string,
  _searchParams?: Pick<URLSearchParams, "get"> | null,
): boolean {
  const base = href.split("?")[0] ?? href;

  if (base === "/dashboard") {
    return (
      pathname === "/dashboard" ||
      (pathname.startsWith("/sources/") &&
        !pathname.startsWith("/sources/web-crawl") &&
        !pathname.startsWith("/sources/builder"))
    );
  }

  if (base === "/sources/web-crawl") {
    return (
      pathname === "/sources/web-crawl" ||
      pathname.startsWith("/sources/web-crawl/")
    );
  }

  if (base === "/sources/builder") {
    return (
      pathname === "/sources/builder" ||
      pathname.startsWith("/sources/builder/")
    );
  }

  return pathname === base || pathname.startsWith(`${base}/`);
}
