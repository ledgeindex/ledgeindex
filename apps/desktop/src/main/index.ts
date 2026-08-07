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
import { DESKTOP_BROWSER_USER_AGENT, isAuthNavigationUrl } from './web-app-url'
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

let mainWindow: BrowserWindow | null = null
let isQuitting = false

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

  win.webContents.on('did-fail-load', (_event, code, desc, url) => {
    console.error('[desktop] renderer did-fail-load', { code, desc, url })
  })
  win.webContents.on('render-process-gone', (_event, details) => {
    console.error('[desktop] renderer process gone', details)
  })

  win.webContents.setWindowOpenHandler((details) => {
    const { url } = details
    if (isAuthNavigationUrl(url)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 520,
          height: 720,
          autoHideMenuBar: true,
          title: 'Sign in',
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true
          }
        }
      }
    }
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  win.webContents.on('did-create-window', (child) => {
    child.webContents.setUserAgent(DESKTOP_BROWSER_USER_AGENT)
    child.setMenuBarVisibility(false)
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

  win.once('ready-to-show', () => {
    if (win.isDestroyed()) return
    if (prefs.startInTray) {
      // Stay hidden — tray click opens the window.
      if (is.dev) {
        // Still attach DevTools in background for debugging if needed.
      }
      return
    }
    win.show()
    if (is.dev) openInAppDevTools(win)
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.ledgeindex.desktop')
  installDevApplicationMenu(() => mainWindow)

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  createAppTray(() => mainWindow)

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
  // Keep running in tray when close-to-tray / start-in-tray is enabled.
  const prefs = getAppPreferences()
  if (prefs.closeToTray || prefs.startInTray) return
  stopDesktopSidecars()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
