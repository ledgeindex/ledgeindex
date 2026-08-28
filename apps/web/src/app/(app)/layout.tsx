import { Suspense } from "react";
import { RequireAuthShell } from "@/components/auth/require-auth-shell";
import { AppShell } from "@/components/app/app-shell";
import { AppErrorBoundary } from "@/components/error-boundary";
import { IndexedFlashProvider } from "@/contexts/indexed-flash-context";
import { DashboardToolbarProvider } from "@/contexts/dashboard-toolbar-context";
import { SourceChatToolbarProvider } from "@/contexts/source-chat-toolbar-context";
import { SourceBuilderToolbarProvider } from "@/contexts/source-builder-toolbar-context";
import { SourceRefreshJobsProvider } from "@/contexts/source-refresh-jobs-context";

function AppShellFallback() {
  return (
    <div className="flex min-h-dvh flex-1 items-center justify-center bg-surface-alt">
      <p className="text-sm text-muted">Loading…</p>
    </div>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <RequireAuthShell>
      <AppErrorBoundary label="app">
        <Suspense fallback={<AppShellFallback />}>
          <IndexedFlashProvider>
            <DashboardToolbarProvider>
              <SourceChatToolbarProvider>
                <SourceBuilderToolbarProvider>
                  <SourceRefreshJobsProvider>
                    <AppShell>{children}</AppShell>
                  </SourceRefreshJobsProvider>
                </SourceBuilderToolbarProvider>
              </SourceChatToolbarProvider>
            </DashboardToolbarProvider>
          </IndexedFlashProvider>
        </Suspense>
      </AppErrorBoundary>
    </RequireAuthShell>
  );
}
