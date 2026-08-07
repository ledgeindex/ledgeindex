import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { SidecarHealth } from '../shared/sidecar-health'
import type { ProviderKeyInput, ProviderKeyStatus } from '../shared/providers'

console.log('[preload] @ledgeindex/desktop preload starting')

const isDev =
  process.env.NODE_ENV === 'development' ||
  Boolean(process.env.ELECTRON_RENDERER_URL) ||
  !process.env.ELECTRON_IS_PACKAGED

const ledgeindexDesktop = {
  isDesktop: true as const,
  isDev,
  platform: process.platform as NodeJS.Platform,
  minimizeWindow: (): Promise<void> => ipcRenderer.invoke('window:minimize'),
  toggleMaximizeWindow: (): Promise<boolean> =>
    ipcRenderer.invoke('window:toggleMaximize'),
  closeWindow: (): Promise<void> => ipcRenderer.invoke('window:close'),
  isWindowMaximized: (): Promise<boolean> => ipcRenderer.invoke('window:isMaximized'),
  toggleDevTools: (): Promise<boolean> => ipcRenderer.invoke('devtools:toggle'),
  openDevTools: (): void => {
    ipcRenderer.send('devtools:open')
  },
  onWindowMaximizedChange: (callback: (maximized: boolean) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, maximized: boolean): void => {
      callback(maximized)
    }
    ipcRenderer.on('window:maximized', handler)
    return () => {
      ipcRenderer.removeListener('window:maximized', handler)
    }
  },
  getSidecarHealth: (): Promise<SidecarHealth> => ipcRenderer.invoke('sidecar:health'),
  restartSidecar: (): Promise<SidecarHealth> => ipcRenderer.invoke('sidecar:restart'),
  getApiOrigin: (): Promise<string> => ipcRenderer.invoke('sidecar:apiOrigin'),
  getProviderKeyStatus: (): Promise<ProviderKeyStatus> =>
    ipcRenderer.invoke('settings:getProviderKeyStatus'),
  saveProviderKeys: (keys: ProviderKeyInput): Promise<ProviderKeyStatus> =>
    ipcRenderer.invoke('settings:saveProviderKeys', keys),
  getAppVersion: (): Promise<string> => ipcRenderer.invoke('update:getVersion'),
  checkForUpdates: (config?: {
    provider?: 'github'
    owner?: string
    repo?: string
    private?: boolean
  }): Promise<{ ok: boolean; version?: string | null; error?: string }> =>
    ipcRenderer.invoke('update:check', config),
  downloadUpdate: (): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('update:download'),
  installUpdate: (): Promise<void> => ipcRenderer.invoke('update:install'),
  onUpdateEvent: (
    callback: (payload: {
      type: string
      info?: {
        version?: string
        releaseName?: string
        releaseNotes?: string | null
        releaseDate?: string | null
      }
      progress?: { percent?: number }
      error?: string
    }) => void
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      payload: {
        type: string
        info?: {
          version?: string
          releaseName?: string
          releaseNotes?: string | null
          releaseDate?: string | null
        }
        progress?: { percent?: number }
        error?: string
      }
    ): void => {
      callback(payload)
    }
    ipcRenderer.on('update:event', handler)
    return () => {
      ipcRenderer.removeListener('update:event', handler)
    }
  }
}

function expose(key: string, value: unknown): void {
  try {
    contextBridge.exposeInMainWorld(key, value)
  } catch (error) {
    console.error('[preload] failed to expose', key, error)
  }
}

if (process.contextIsolated) {
  expose('electron', electronAPI)
  expose('ledgeindexDesktop', ledgeindexDesktop)
} else {
  // @ts-ignore
  window.electron = electronAPI
  // @ts-ignore
  window.ledgeindexDesktop = ledgeindexDesktop
}
