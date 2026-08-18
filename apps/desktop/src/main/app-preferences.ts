import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export type AppPreferences = {
  /** Launch at OS login (Windows/macOS login item). */
  openAtLogin: boolean
  /** Launch hidden; only the tray icon is visible until the user opens the window. */
  startInTray: boolean
  /** Window close (X) hides to tray instead of quitting. */
  closeToTray: boolean
}

const DEFAULTS: AppPreferences = {
  openAtLogin: false,
  startInTray: false,
  closeToTray: true
}

function prefsPath(): string {
  const dir = app.getPath('userData')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return join(dir, 'app-preferences.json')
}

function applyLoginItemSettings(prefs: AppPreferences): void {
  // Login items only apply meaningfully for packaged builds; still set so
  // preference state stays consistent in dev.
  try {
    app.setLoginItemSettings({
      openAtLogin: prefs.openAtLogin,
      openAsHidden: prefs.openAtLogin && prefs.startInTray
    })
  } catch (error) {
    console.warn('[desktop] setLoginItemSettings failed', error)
  }
}

function readStoredPreferences(): AppPreferences {
  const path = prefsPath()
  if (!existsSync(path)) return { ...DEFAULTS }
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<AppPreferences>
    return {
      openAtLogin: Boolean(raw.openAtLogin),
      startInTray: Boolean(raw.startInTray),
      closeToTray:
        typeof raw.closeToTray === 'boolean' ? raw.closeToTray : DEFAULTS.closeToTray
    }
  } catch {
    return { ...DEFAULTS }
  }
}

export function getAppPreferences(): AppPreferences {
  const stored = readStoredPreferences()
  // Prefer OS login-item state when readable (user may have changed it in system settings).
  try {
    const login = app.getLoginItemSettings()
    if (typeof login.openAtLogin === 'boolean') {
      stored.openAtLogin = login.openAtLogin
    }
  } catch {
    // keep stored
  }
  return stored
}

export function setAppPreferences(
  patch: Partial<AppPreferences>
): AppPreferences {
  const next = { ...readStoredPreferences(), ...patch }
  // Keep openAtLogin from OS if patch omitted it but we synced on get.
  if (patch.openAtLogin === undefined) {
    try {
      const login = app.getLoginItemSettings()
      if (typeof login.openAtLogin === 'boolean') {
        next.openAtLogin = login.openAtLogin
      }
    } catch {
      // keep next.openAtLogin from stored
    }
  }
  writeFileSync(prefsPath(), JSON.stringify(next, null, 2), 'utf8')
  applyLoginItemSettings(next)
  return next
}

/** Call once after app.ready so a previously saved preference is applied. */
export function syncLoginItemFromPreferences(): void {
  applyLoginItemSettings(readStoredPreferences())
}
