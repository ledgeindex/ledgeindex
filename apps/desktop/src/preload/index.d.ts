import { ElectronAPI } from '@electron-toolkit/preload'
import type { SidecarHealth } from '../shared/sidecar-health'
import type { ProviderKeyInput, ProviderKeyStatus } from '../shared/providers'

export type { SidecarHealth, SidecarStatus } from '../shared/sidecar-health'
export type { ProviderId, ProviderKeyInput, ProviderKeyStatus } from '../shared/providers'

export type DesktopUpdateEvent = {
  type: string
  info?: {
    version?: string
    releaseName?: string
    releaseNotes?: string | string[] | null
    releaseDate?: string | null
  }
  progress?: { percent?: number }
  error?: string
}

export type LedgeIndexDesktopApi = {
  isDesktop: true
  isDev: boolean
  platform: NodeJS.Platform
  minimizeWindow: () => Promise<void>
  toggleMaximizeWindow: () => Promise<boolean>
  closeWindow: () => Promise<void>
  isWindowMaximized: () => Promise<boolean>
  toggleDevTools: () => Promise<boolean>
  openDevTools: () => void
  onWindowMaximizedChange: (callback: (maximized: boolean) => void) => () => void
  getSidecarHealth: () => Promise<SidecarHealth>
  restartSidecar: () => Promise<SidecarHealth>
  getApiOrigin: () => Promise<string>
  getProviderKeyStatus: () => Promise<ProviderKeyStatus>
  saveProviderKeys: (keys: ProviderKeyInput) => Promise<ProviderKeyStatus>
  getCrawlProvider: () => Promise<ProviderId | null>
  setCrawlProvider: (id: ProviderId | null) => Promise<ProviderId | null>
  getAppPreferences: () => Promise<{
    openAtLogin: boolean
    startInTray: boolean
    closeToTray: boolean
  }>
  setAppPreferences: (
    patch: Partial<{
      openAtLogin: boolean
      startInTray: boolean
      closeToTray: boolean
    }>
  ) => Promise<{
    openAtLogin: boolean
    startInTray: boolean
    closeToTray: boolean
  }>
  getAppVersion: () => Promise<string>
  checkForUpdates: (config?: {
    provider?: 'github'
    owner?: string
    repo?: string
    private?: boolean
  }) => Promise<{ ok: boolean; version?: string | null; error?: string }>
  downloadUpdate: () => Promise<{ ok: boolean; error?: string }>
  installUpdate: () => Promise<void>
  onUpdateEvent: (callback: (payload: DesktopUpdateEvent) => void) => () => void
}

declare global {
  interface Window {
    electron: ElectronAPI
    ledgeindexDesktop?: LedgeIndexDesktopApi
  }
}

export {}
