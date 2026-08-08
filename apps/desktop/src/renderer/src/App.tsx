import { useEffect } from 'react'
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { setLedgeIndexApiBaseUrl } from '@ledgeindex/client'
import { Providers } from '@/components/providers'
import { RequireAuthShell } from '@/components/auth/require-auth-shell'
import { AppShell } from '@/components/app/app-shell'
import { AppErrorBoundary } from '@/components/error-boundary'
import { IndexedFlashProvider } from '@/contexts/indexed-flash-context'
import { DashboardToolbarProvider } from '@/contexts/dashboard-toolbar-context'
import { SourceChatToolbarProvider } from '@/contexts/source-chat-toolbar-context'
import { SourceBuilderToolbarProvider } from '@/contexts/source-builder-toolbar-context'
import { getLedgeIndexDesktop } from '@/lib/ledgeindex-desktop'
import {
  resolveDesktopLocalApiUrl,
  syncDesktopApiBaseForScope
} from '@/lib/desktop-api-routing'
import LoginPage from '@/app/login/page'
import DashboardPage from '@/app/(app)/dashboard/page'
import WebCrawlPage from '@/app/(app)/sources/web-crawl/page'
import SourceBuilderPage from '@/app/(app)/sources/builder/page'
import SourceBuilderDraftPage from '@/app/(app)/sources/builder/[draftId]/page'
import SourceChatPage from '@/app/(app)/sources/[sourceId]/chat/page'
import SourceSetsPage from '@/app/(app)/source-sets/page'
import McpConnectPage from '@/app/(app)/mcp/connect/page'
import ApiKeysPage from '@/app/(app)/api-keys/page'
import DesktopProviderKeysPage from '@/app/(app)/settings/providers/page'
import ExploreChatPage from '@/app/(app)/chat/page'
import AdminUsersPage from '@/app/(app)/admin/users/page'
import AdminSourceUpdaterPage from '@/app/(app)/admin/source-updater/page'

const FALLBACK_DESKTOP_API = 'http://127.0.0.1:3015'

function AuthenticatedApp(): React.JSX.Element {
  return (
    <RequireAuthShell>
      <AppErrorBoundary label="desktop-app">
        <IndexedFlashProvider>
          <DashboardToolbarProvider>
            <SourceChatToolbarProvider>
              <SourceBuilderToolbarProvider>
                <AppShell>
                  <AppErrorBoundary label="page">
                    <Routes>
                      <Route path="/dashboard" element={<DashboardPage />} />
                      <Route path="/sources/web-crawl" element={<WebCrawlPage />} />
                      <Route path="/sources/builder" element={<SourceBuilderPage />} />
                      <Route
                        path="/sources/builder/:draftId"
                        element={<SourceBuilderDraftPage />}
                      />
                      <Route path="/sources/:sourceId/chat" element={<SourceChatPage />} />
                      <Route path="/source-sets" element={<SourceSetsPage />} />
                      <Route path="/mcp/connect" element={<McpConnectPage />} />
                      <Route path="/api-keys" element={<ApiKeysPage />} />
                      <Route
                        path="/settings/providers"
                        element={<DesktopProviderKeysPage />}
                      />
                      <Route path="/admin/users" element={<AdminUsersPage />} />
                      <Route
                        path="/admin/source-updater"
                        element={<AdminSourceUpdaterPage />}
                      />
                      <Route path="/chat" element={<ExploreChatPage />} />
                      <Route path="/" element={<Navigate to="/chat" replace />} />
                      <Route path="*" element={<Navigate to="/chat" replace />} />
                    </Routes>
                  </AppErrorBoundary>
                </AppShell>
              </SourceBuilderToolbarProvider>
            </SourceChatToolbarProvider>
          </DashboardToolbarProvider>
        </IndexedFlashProvider>
      </AppErrorBoundary>
    </RequireAuthShell>
  )
}

export default function App(): React.JSX.Element {
  useEffect(() => {
    let cancelled = false
    // Paint the shell immediately with the known local origin; refine via IPC.
    const fallback = resolveDesktopLocalApiUrl() || FALLBACK_DESKTOP_API
    setLedgeIndexApiBaseUrl(fallback)
    syncDesktopApiBaseForScope('personal')

    void (async () => {
      const desktop = getLedgeIndexDesktop()
      const origin =
        (desktop?.getApiOrigin ? await desktop.getApiOrigin() : null) || fallback
      if (cancelled) return
      setLedgeIndexApiBaseUrl(origin)
      syncDesktopApiBaseForScope('personal')
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <Providers>
      <AppErrorBoundary label="root">
        <HashRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/*" element={<AuthenticatedApp />} />
          </Routes>
        </HashRouter>
      </AppErrorBoundary>
    </Providers>
  )
}
