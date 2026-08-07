import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export type AppPreferences = {
  /** Launch hidden; only the tray icon is visible until the user opens the window. */
  startInTray: boolean
  /** Window close (X) hides to tray instead of quitting. */
  closeToTray: boolean
}

const DEFAULTS: AppPreferences = {
  startInTray: false,
  closeToTray: true
}

function prefsPath(): string {
  const dir = app.getPath('userData')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return join(dir, 'app-preferences.json')
}

export function getAppPreferences(): AppPreferences {
  const path = prefsPath()
  if (!existsSync(path)) return { ...DEFAULTS }
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<AppPreferences>
    return {
      startInTray: Boolean(raw.startInTray),
      closeToTray:
        typeof raw.closeToTray === 'boolean' ? raw.closeToTray : DEFAULTS.closeToTray
    }
  } catch {
    return { ...DEFAULTS }
  }
}

export function setAppPreferences(
  patch: Partial<AppPreferences>
): AppPreferences {
  const next = { ...getAppPreferences(), ...patch }
  writeFileSync(prefsPath(), JSON.stringify(next, null, 2), 'utf8')
  return next
}
