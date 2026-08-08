import './gpu-sandbox-fix'
import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import {
  attachDevToolsKeyboardShortcuts,
  installDevApplicationMenu,
  openInAppDevTools,
  toggleInAppDevTools
} from './devtools'
import { DESKTOP_BROWSER_USER_AGENT } from './web-app-url'
import {
  DESKTOP_SERVER_PORT,
  ensureApiRunning,
  getSidecarHealth,
  resolveApiOrigin,
  restartDesktopSidecar,
  stopDesktopSidecars
} from './sidecars'
import { getProviderKeyStatus, saveProviderKeys } from './provider-settings'
import type { ProviderKeyInput } from '../shared/providers'
import { registerAutoUpdate, scheduleStartupUpdateCheck } from './auto-update'
import {
  getAppPreferences,
  setAppPreferences,
  type AppPreferences
} from './app-preferences'
import { createAppTray, destroyAppTray } from './tray'
import { registerGoogleOAuthIpc } from './google-oauth-loopback'

let mainWindow: BrowserWindow | null = null
let isQuitting = false

/** ERR_ABORTED — normal during navigation, not a failure worth retrying. */
const ERR_ABORTED = -3
/** Safety net only. A healthy start loads on the first attempt. */
const MAX_RENDERER_LOAD_ATTEMPTS = 3

function loadRenderer(win: BrowserWindow): Promise<void> {
  // Packaged UI stays on file://. Google sign-in opens the system browser and
  // returns via 127.0.0.1 loopback — see google-oauth-loopback.ts.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    return win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  }
  return win.loadFile(join(__dirname, '../renderer/index.html'))
}

function createWindow(): void {
  const preloadPath = join(__dirname, '../preload/index.js')
  const prefs = getAppPreferences()

  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: 'LedgeIndex',
    frame: false,
    autoHideMenuBar: true,
    backgroundColor: '#F7F5F2',
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: preloadPath,
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow = win
  win.webContents.setUserAgent(DESKTOP_BROWSER_USER_AGENT)

  // Only ever reveals the window on first paint or on a dead renderer. Must not
  // re-show later: the user closing to tray also makes the window invisible.
  let hasRevealedWindow = false
  const revealWindowOnce = (): void => {
    if (win.isDestroyed() || hasRevealedWindow || prefs.startInTray) return
    hasRevealedWindow = true
    win.show()
    if (is.dev) openInAppDevTools(win)
  }

  // A single failed load used to leave the window blank white until restart,
  // e.g. when Chromium's network service restarts mid-load.
  let loadAttempts = 1
  win.webContents.on('did-fail-load', (_event, code, desc, url, isMainFrame) => {
    if (!isMainFrame || code === ERR_ABORTED) return
    console.error('[desktop] renderer did-fail-load', { code, desc, url, loadAttempts })
    if (loadAttempts >= MAX_RENDERER_LOAD_ATTEMPTS) {
      console.error('[desktop] giving up on renderer load after', loadAttempts, 'attempts')
      // ready-to-show never fires for a renderer that never painted; show the
      // window anyway so the app is not just a tray icon with no explanation.
      revealWindowOnce()
      return
    }
    const delay = Math.min(2_000, 250 * loadAttempts)
    loadAttempts += 1
    setTimeout(() => {
      if (win.isDestroyed()) return
      void loadRenderer(win)
    }, delay)
  })
  win.webContents.on('did-finish-load', () => {
    loadAttempts = 1
  })
  win.webContents.on('render-process-gone', (_event, details) => {
    console.error('[desktop] renderer process gone', details)
  })

  win.webContents.setWindowOpenHandler((details) => {
    // Never open target=_blank inside Electron (esp. Google auth — blocked as
    // insecure embedded browser). Desktop Google sign-in uses shell.openExternal
    // + loopback in google-oauth-loopback.ts.
    void shell.openExternal(details.url)
    return { action: 'deny' }
  })

  attachDevToolsKeyboardShortcuts(win)

  win.on('maximize', () => {
    win.webContents.send('window:maximized', true)
  })
  win.on('unmaximize', () => {
    win.webContents.send('window:maximized', false)
  })

  win.on('close', (event) => {
    if (!isQuitting && getAppPreferences().closeToTray) {
      event.preventDefault()
      win.hide()
    }
  })

  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })

  win.once('ready-to-show', revealWindowOnce)

  void loadRenderer(win)
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.ledgeindex.desktop')
  installDevApplicationMenu(() => mainWindow)

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  createAppTray(() => mainWindow)
  registerGoogleOAuthIpc()

  ipcMain.handle('window:minimize', () => {
    mainWindow?.minimize()
  })
  ipcMain.handle('window:toggleMaximize', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return false
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize()
      return false
    }
    mainWindow.maximize()
    return true
  })
  ipcMain.handle('window:close', () => {
    mainWindow?.close()
  })
  ipcMain.handle('window:isMaximized', () => mainWindow?.isMaximized() ?? false)

  ipcMain.handle('devtools:toggle', () => toggleInAppDevTools(mainWindow))
  ipcMain.on('devtools:open', () => {
    openInAppDevTools(mainWindow)
  })

  ipcMain.handle('sidecar:health', () => getSidecarHealth())
  ipcMain.handle('sidecar:restart', () => restartDesktopSidecar())
  ipcMain.handle('sidecar:apiOrigin', () => resolveApiOrigin())

  ipcMain.handle('settings:getProviderKeyStatus', () => getProviderKeyStatus())
  ipcMain.handle('settings:saveProviderKeys', async (_event, keys: ProviderKeyInput) => {
    const status = saveProviderKeys(keys ?? {})
    try {
      await restartDesktopSidecar()
    } catch (error) {
      console.error('[desktop] restart after saving provider keys failed', error)
    }
    return status
  })

  ipcMain.handle('settings:getAppPreferences', () => getAppPreferences())
  ipcMain.handle(
    'settings:setAppPreferences',
    (_event, patch: Partial<AppPreferences>) => setAppPreferences(patch ?? {})
  )

  registerAutoUpdate(() => mainWindow)

  createWindow()
  scheduleStartupUpdateCheck(() => mainWindow)
  void ensureApiRunning()
    .then(() => {
      console.log('[desktop] API origin', resolveApiOrigin(), 'port', DESKTOP_SERVER_PORT)
    })
    .catch((error) => {
      console.error('[desktop] could not start desktop-server sidecar', error)
    })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
      return
    }
    const win = mainWindow
    if (win && !win.isDestroyed()) {
      win.show()
      win.focus()
    }
  })
})

app.on('before-quit', () => {
  isQuitting = true
  destroyAppTray()
  stopDesktopSidecars()
})

app.on('window-all-closed', () => {
  const prefs = getAppPreferences()
  if (prefs.closeToTray || prefs.startInTray) return
  stopDesktopSidecars()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
