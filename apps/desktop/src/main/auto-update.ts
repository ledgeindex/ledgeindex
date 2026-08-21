import { app, BrowserWindow, ipcMain, type WebContents } from 'electron'
import { autoUpdater } from 'electron-updater'
import { is } from '@electron-toolkit/utils'

export type UpdateFeedConfig = {
  provider?: 'github'
  owner?: string
  repo?: string
  private?: boolean
}

const DEFAULT_FEED: Required<UpdateFeedConfig> = {
  provider: 'github',
  owner: 'ledgeindex',
  repo: 'ledgeindex',
  private: false
}

let listenersBoundTo: WebContents | null = null

function send(wc: WebContents | null | undefined, payload: Record<string, unknown>): void {
  if (!wc || wc.isDestroyed()) return
  wc.send('update:event', payload)
}

function bindListeners(wc: WebContents): void {
  if (listenersBoundTo === wc) return
  autoUpdater.removeAllListeners()
  listenersBoundTo = wc

  autoUpdater.on('checking-for-update', () => {
    send(wc, { type: 'checking-for-update' })
  })
  autoUpdater.on('update-available', (info) => {
    send(wc, {
      type: 'update-available',
      info: {
        version: info.version,
        releaseName: info.releaseName ?? info.version,
        releaseNotes: info.releaseNotes ?? null,
        releaseDate: info.releaseDate ?? null
      }
    })
  })
  autoUpdater.on('update-not-available', (info) => {
    send(wc, {
      type: 'update-not-available',
      info: { version: info.version }
    })
  })
  autoUpdater.on('download-progress', (progress) => {
    send(wc, {
      type: 'download-progress',
      progress: {
        percent: progress.percent,
        transferred: progress.transferred,
        total: progress.total,
        bytesPerSecond: progress.bytesPerSecond
      }
    })
  })
  autoUpdater.on('update-downloaded', (info) => {
    send(wc, {
      type: 'update-downloaded',
      info: {
        version: info.version,
        releaseName: info.releaseName ?? info.version,
        releaseNotes: info.releaseNotes ?? null
      }
    })
  })
  autoUpdater.on('error', (error) => {
    send(wc, { type: 'error', error: error?.message || String(error) })
  })
}

function applyFeed(config?: UpdateFeedConfig): void {
  const feed = {
    provider: config?.provider || DEFAULT_FEED.provider,
    owner: config?.owner || DEFAULT_FEED.owner,
    repo: config?.repo || DEFAULT_FEED.repo,
    private: Boolean(config?.private ?? DEFAULT_FEED.private)
  }
  autoUpdater.setFeedURL(feed)
}

/**
 * Register IPC + configure electron-updater (GitHub Releases on ledgeindex/ledgeindex).
 * autoDownload is off — UI confirms before download / install.
 */
export function registerAutoUpdate(getMainWindow: () => BrowserWindow | null): void {
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  // Windows builds are unsigned (no Authenticode cert). 0.2.10 was accidentally
  // signed with the Apple Developer ID via CSC_LINK on the Windows runner;
  // leaving verification on would block every later unsigned update.
  if (process.platform === 'win32') {
    autoUpdater.verifyUpdateCodeSignature = false
  }

  // Packaged builds read publish config from electron-builder; setFeedURL still ok.
  applyFeed()

  ipcMain.handle('update:getVersion', () => app.getVersion())

  ipcMain.handle('update:check', async (event, config?: UpdateFeedConfig) => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? getMainWindow()
    const wc = win?.webContents ?? event.sender
    bindListeners(wc)

    if (!app.isPackaged || is.dev) {
      // Allow checking a real feed in dev when forceDevUpdateConfig + dev-app-update.yml exist.
      autoUpdater.forceDevUpdateConfig = true
      applyFeed(config)
    } else {
      applyFeed(config)
    }

    try {
      const result = await autoUpdater.checkForUpdates()
      return {
        ok: true,
        version: result?.updateInfo?.version ?? null
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      send(wc, { type: 'error', error: message })
      return { ok: false, error: message }
    }
  })

  ipcMain.handle('update:download', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? getMainWindow()
    if (win) bindListeners(win.webContents)
    try {
      await autoUpdater.downloadUpdate()
      return { ok: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { ok: false, error: message }
    }
  })

  ipcMain.handle('update:install', () => {
    autoUpdater.quitAndInstall(false, true)
  })
}

/** Quiet background check after UI is up (packaged only). */
export function scheduleStartupUpdateCheck(getMainWindow: () => BrowserWindow | null): void {
  if (!app.isPackaged) return
  setTimeout(() => {
    const win = getMainWindow()
    if (!win || win.isDestroyed()) return
    bindListeners(win.webContents)
    applyFeed()
    void autoUpdater.checkForUpdates().catch((error) => {
      console.warn('[desktop] startup update check failed', error)
    })
  }, 8_000)
}
