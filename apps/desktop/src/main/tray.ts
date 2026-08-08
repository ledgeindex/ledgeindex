import { Tray, Menu, nativeImage, app, type BrowserWindow } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

let tray: Tray | null = null

function resolveTrayIcon(): Electron.NativeImage {
  // Packaged: extraResources copies resources/icon.png → process.resourcesPath/icon.png
  // Dev / asar-unpacked: fall back to app-relative and __dirname-relative paths.
  const candidates = [
    join(process.resourcesPath, 'icon.png'),
    join(process.resourcesPath, 'app.asar.unpacked', 'resources', 'icon.png'),
    join(app.getAppPath(), 'resources', 'icon.png'),
    join(__dirname, '../../resources/icon.png'),
    join(__dirname, '../resources/icon.png')
  ]

  for (const path of candidates) {
    if (!existsSync(path)) continue
    const img = nativeImage.createFromPath(path)
    if (!img.isEmpty()) {
      return img.resize({ width: 16, height: 16 })
    }
  }

  // Last resort: non-empty icon so Windows still shows a tray entry.
  const fallback = nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
  )
  return fallback.isEmpty() ? nativeImage.createEmpty() : fallback.resize({ width: 16, height: 16 })
}

export function createAppTray(getMainWindow: () => BrowserWindow | null): Tray {
  if (tray) return tray

  tray = new Tray(resolveTrayIcon())
  tray.setToolTip('LedgeIndex')

  const show = (): void => {
    const win = getMainWindow()
    if (!win || win.isDestroyed()) return
    win.show()
    win.focus()
  }

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Open LedgeIndex',
      click: () => show()
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.quit()
      }
    }
  ])
  tray.setContextMenu(contextMenu)
  tray.on('click', () => show())
  tray.on('double-click', () => show())

  return tray
}

export function destroyAppTray(): void {
  tray?.destroy()
  tray = null
}
