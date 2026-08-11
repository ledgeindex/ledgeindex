"use client";

import { useRouter, useSearchParams } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { DashboardViewMode } from "@/components/sources/dashboard-view-toggle";
import type { KnowledgeSetScope } from "@/components/sources/knowledge-set-scope-toggle";
import { syncDesktopApiBaseForScope } from "@/lib/desktop-api-routing";

export const DASHBOARD_VIEW_STORAGE_KEY = "knowledgeindex:dashboard-view";
export const DASHBOARD_SCOPE_STORAGE_KEY = "knowledgeindex:dashboard-scope";

function readStoredViewMode(): DashboardViewMode {
  if (typeof window === "undefined") return "list";
  const stored =
    window.localStorage.getItem(DASHBOARD_VIEW_STORAGE_KEY) ??
    window.localStorage.getItem("ledgeindex:dashboard-view");
  return stored === "grid" ? "grid" : "list";
}

function readStoredScope(): KnowledgeSetScope {
  if (typeof window === "undefined") return "personal";
  const stored = window.localStorage.getItem(DASHBOARD_SCOPE_STORAGE_KEY);
  return stored === "global" ? "global" : "personal";
}

function resolveDashboardScope(scopeParam: string | null): KnowledgeSetScope {
  if (scopeParam === "global" || scopeParam === "personal") {
    return scopeParam;
  }
  return readStoredScope();
}

type DashboardToolbarContextValue = {
  scope: KnowledgeSetScope;
  viewMode: DashboardViewMode;
  ready: boolean;
  setScope: (next: KnowledgeSetScope) => void;
  setViewMode: (next: DashboardViewMode) => void;
};

const DashboardToolbarContext = createContext<DashboardToolbarContextValue | null>(
  null,
);

export function DashboardToolbarProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const scopeParam = searchParams.get("scope");
  const [viewMode, setViewModeState] = useState<DashboardViewMode>("list");
  const [scope, setScopeState] = useState<KnowledgeSetScope>("personal");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setViewModeState(readStoredViewMode());
    const next = resolveDashboardScope(scopeParam);
    setScopeState(next);
    syncDesktopApiBaseForScope(next);
    setReady(true);
  }, [scopeParam]);

  const setScope = useCallback(
    (next: KnowledgeSetScope) => {
      setScopeState(next);
      window.localStorage.setItem(DASHBOARD_SCOPE_STORAGE_KEY, next);
      syncDesktopApiBaseForScope(next);

      const params = new URLSearchParams(window.location.search);
      if (next === "global") {
        params.set("scope", "global");
      } else {
        params.delete("scope");
      }
      const query = params.toString();
      router.replace(query ? `/dashboard?${query}` : "/dashboard", {
        scroll: false,
      });
    },
    [router],
  );

  const setViewMode = useCallback((next: DashboardViewMode) => {
    setViewModeState(next);
    window.localStorage.setItem(DASHBOARD_VIEW_STORAGE_KEY, next);
  }, []);

  const value = useMemo(
    () => ({ scope, viewMode, ready, setScope, setViewMode }),
    [scope, viewMode, ready, setScope, setViewMode],
  );

  return (
    <DashboardToolbarContext.Provider value={value}>
      {children}
    </DashboardToolbarContext.Provider>
  );
}

export function useDashboardToolbar() {
  const context = useContext(DashboardToolbarContext);
  if (!context) {
    throw new Error("useDashboardToolbar must be used within DashboardToolbarProvider");
  }
  return context;
}
