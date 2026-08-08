import { Suspense } from "react";
import { RequireAuthShell } from "@/components/auth/require-auth-shell";
import { AppShell } from "@/components/app/app-shell";
import { IndexedFlashProvider } from "@/contexts/indexed-flash-context";
import { DashboardToolbarProvider } from "@/contexts/dashboard-toolbar-context";
import { SourceChatToolbarProvider } from "@/contexts/source-chat-toolbar-context";
import { SourceBuilderToolbarProvider } from "@/contexts/source-builder-toolbar-context";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <RequireAuthShell>
      <Suspense fallback={null}>
        <IndexedFlashProvider>
          <DashboardToolbarProvider>
            <SourceChatToolbarProvider>
              <SourceBuilderToolbarProvider>
                <AppShell>{children}</AppShell>
              </SourceBuilderToolbarProvider>
            </SourceChatToolbarProvider>
          </DashboardToolbarProvider>
        </IndexedFlashProvider>
      </Suspense>
    </RequireAuthShell>
  );
}
