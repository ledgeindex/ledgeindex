import { app } from 'electron'

/**
 * Windows + Electron 39: GPU sandbox can crash startup, and `disable-gpu-sandbox`
 * alone often leaves DevTools "open" without a usable UI. Match AutomationGhost:
 * use `no-sandbox` in development; narrower switch when packaged.
 */
if (process.platform === 'win32') {
  app.commandLine.appendSwitch(app.isPackaged ? 'disable-gpu-sandbox' : 'no-sandbox')
}

if (!app.isPackaged) {
  // Prefer an explicit free port. Fixed 9222 collides when a previous Electron
  // instance (or Chrome) still holds it → "Cannot start http server for devtools".
  const debugPort =
    process.env.REMOTE_DEBUGGING_PORT?.trim() ||
    process.env.LEDGEINDEX_DESKTOP_DEBUG_PORT?.trim() ||
    '9333'
  app.commandLine.appendSwitch('remote-debugging-port', debugPort)
}
