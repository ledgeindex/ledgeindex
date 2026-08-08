"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { LogOut } from "lucide-react";
import { SiteBrand } from "@/components/site-brand";
import { ThemeToggle } from "@/components/theme-toggle-slot";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth-context";
import { APP_NAV_ITEMS, isAppNavActive } from "@/lib/app-navigation";
import {
  useLedgeIndexDesktop,
  type LedgeIndexDesktopApi,
} from "@/lib/ledgeindex-desktop";
import { cn } from "@/lib/utils";

export function AppSidebar({
  className,
  onNavigate,
}: {
  className?: string;
  onNavigate?: () => void;
}) {
  return (
    <Suspense
      fallback={
        <aside
          className={cn(
            "flex w-[15.5rem] shrink-0 flex-col border-r border-border bg-card-solid [-webkit-app-region:no-drag]",
            className,
          )}
          aria-hidden
        />
      }
    >
      <AppSidebarInner className={className} onNavigate={onNavigate} />
    </Suspense>
  );
}

function AppSidebarInner({
  className,
  onNavigate,
}: {
  className?: string;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { user, profile, signOut } = useAuth();
  const desktop = useLedgeIndexDesktop();
  const isAdmin = profile?.role === "admin";
  const appVersion = useAppVersion(desktop);

  const navItems = APP_NAV_ITEMS.filter(
    (item) =>
      (!item.adminOnly || isAdmin) && (!item.desktopOnly || Boolean(desktop)),
  );

  return (
    <aside
      className={cn(
        "flex w-[15.5rem] shrink-0 flex-col border-r border-border bg-card-solid [-webkit-app-region:no-drag]",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <SiteBrand href="/dashboard" showWordmark />
        <div className="flex items-center gap-1">
          <ThemeToggle />
        </div>
      </div>

      <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-3 py-4">
        {navItems.map((item) => {
          const active = isAppNavActive(pathname, item.href, searchParams);
          const Icon = item.icon;
          return (
            <Link
              key={item.id}
              href={item.href}
              onClick={onNavigate}
              className={cn(
                "flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                active
                  ? "bg-accent/12 text-foreground"
                  : "text-muted hover:bg-surface-raised hover:text-foreground",
              )}
            >
              <Icon className="size-4 shrink-0" />
              <span className="truncate">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-border px-4 py-4">
        {user ? (
          <div className="mb-3 min-w-0">
            <p className="truncate text-sm font-medium text-foreground">
              {user.displayName ?? "Signed in"}
            </p>
            <div className="flex items-baseline gap-2">
              <p className="truncate text-xs text-muted">{user.email}</p>
              {appVersion ? (
                <span className="ml-auto shrink-0 font-mono text-[0.625rem] text-muted/60">
                  v{appVersion}
                </span>
              ) : null}
            </div>
            {isAdmin ? (
              <p className="mt-1 font-mono text-[0.5625rem] font-semibold tracking-[0.12em] text-accent uppercase">
                Admin
              </p>
            ) : null}
          </div>
        ) : null}
        <Button
          variant="secondary"
          className="h-9 w-full justify-start gap-2 px-3 text-sm"
          onClick={() => void signOut()}
        >
          <LogOut className="size-4" />
          Sign out
        </Button>
      </div>
    </aside>
  );
}

/**
 * Desktop reports the installed Electron build over IPC; the web build only knows
 * the version Next inlined at compile time.
 */
function useAppVersion(desktop: LedgeIndexDesktopApi | null): string | null {
  const [version, setVersion] = useState<string | null>(
    process.env.NEXT_PUBLIC_APP_VERSION ?? null,
  );

  useEffect(() => {
    if (!desktop?.getAppVersion) return;
    let cancelled = false;
    void desktop
      .getAppVersion()
      .then((value) => {
        if (!cancelled && value) setVersion(value);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [desktop]);

  return version;
}
