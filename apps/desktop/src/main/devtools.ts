import { app, BrowserWindow, Menu } from 'electron'

export function openInAppDevTools(mainWindow: BrowserWindow | null): boolean {
  const win = BrowserWindow.getFocusedWindow() ?? mainWindow
  if (!win || win.isDestroyed()) return false

  const contents = win.webContents
  if (contents.isDestroyed()) return false

  contents.openDevTools({ mode: 'right', activate: true })
  win.focus()
  return true
}

export function toggleInAppDevTools(mainWindow: BrowserWindow | null): boolean {
  const win = BrowserWindow.getFocusedWindow() ?? mainWindow
  if (!win || win.isDestroyed()) return false

  const contents = win.webContents
  if (contents.isDestroyed()) return false

  if (contents.isDevToolsOpened()) {
    contents.closeDevTools()
    return false
  }

  return openInAppDevTools(win)
}

export function installDevApplicationMenu(
  getWindow: () => BrowserWindow | null
): void {
  if (app.isPackaged) return

  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: 'View',
        submenu: [
          {
            label: 'Toggle Developer Tools',
            accelerator: 'CmdOrCtrl+Shift+I',
            click: () => {
              toggleInAppDevTools(getWindow())
            }
          },
          { type: 'separator' },
          { role: 'reload' },
          { role: 'forceReload' }
        ]
      }
    ])
  )
}

export function attachDevToolsKeyboardShortcuts(win: BrowserWindow): void {
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return

    const mod = input.control || input.meta
    const isF12 = input.key === 'F12'
    const isChromeShortcut = mod && input.shift && input.key.toLowerCase() === 'i'

    if (!isF12 && !isChromeShortcut) return

    event.preventDefault()
    toggleInAppDevTools(win)
  })
}
