import { Tray, Menu, nativeImage, app, type BrowserWindow } from 'electron'
import { join } from 'node:path'

let tray: Tray | null = null

function resolveTrayIcon(): Electron.NativeImage {
  const candidates = [
    join(__dirname, '../../resources/icon.png'),
    join(process.resourcesPath, 'icon.png'),
    join(app.getAppPath(), 'resources/icon.png')
  ]
  for (const path of candidates) {
    const img = nativeImage.createFromPath(path)
    if (!img.isEmpty()) {
      return img.resize({ width: 16, height: 16 })
    }
  }
  return nativeImage.createEmpty()
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
