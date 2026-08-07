import { app, safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  PROVIDER_IDS,
  type ProviderId,
  type ProviderKeyInput,
  type ProviderKeyStatus,
  emptyProviderKeyStatus
} from '../shared/providers'

const ENV_BY_PROVIDER: Record<ProviderId, string[]> = {
  openai: ['OPENAI_API_KEY'],
  google: ['GOOGLE_GENERATIVE_AI_API_KEY', 'GOOGLE_API_KEY'],
  deepseek: ['DEEPSEEK_API_KEY']
}

type SettingsFile = {
  keysEnc?: Partial<Record<ProviderId, string>>
}

function settingsPath(): string {
  const dir = app.getPath('userData')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return join(dir, 'provider-settings.json')
}

function readSettings(): SettingsFile {
  const path = settingsPath()
  if (!existsSync(path)) return {}
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as SettingsFile
  } catch {
    return {}
  }
}

function writeSettings(data: SettingsFile): void {
  writeFileSync(settingsPath(), JSON.stringify(data, null, 2), 'utf8')
}

function encryptValue(value: string): string {
  const encoded = safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(value)
    : Buffer.from(value, 'utf8')
  return encoded.toString('base64')
}

function decryptValue(encoded: string): string | null {
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(Buffer.from(encoded, 'base64'))
    }
    return Buffer.from(encoded, 'base64').toString('utf8')
  } catch {
    return null
  }
}

function getStoredKey(provider: ProviderId): string | null {
  const enc = readSettings().keysEnc?.[provider]
  if (!enc) return null
  return decryptValue(enc)
}

function getEnvKey(provider: ProviderId): string | null {
  for (const name of ENV_BY_PROVIDER[provider]) {
    const value = process.env[name]?.trim()
    if (value) return value
  }
  return null
}

export function getProviderKey(provider: ProviderId): string | null {
  return getEnvKey(provider) ?? getStoredKey(provider)
}

export function getProviderKeyStatus(): ProviderKeyStatus {
  const status = emptyProviderKeyStatus()
  for (const id of PROVIDER_IDS) {
    status[id] = getProviderKey(id) !== null
  }
  return status
}

/** Save keys. Empty string clears; omit / whitespace-only keeps existing. */
export function saveProviderKeys(input: ProviderKeyInput): ProviderKeyStatus {
  const current = readSettings()
  const keysEnc: Partial<Record<ProviderId, string>> = { ...current.keysEnc }

  for (const id of PROVIDER_IDS) {
    if (!(id in input)) continue
    const raw = input[id]
    if (raw === undefined) continue
    const trimmed = raw.trim()
    if (!trimmed) {
      delete keysEnc[id]
    } else {
      keysEnc[id] = encryptValue(trimmed)
    }
  }

  writeSettings({ ...current, keysEnc })
  return getProviderKeyStatus()
}

/** Env vars injected into the desktop-server sidecar. */
export function buildProviderEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  const openai = getProviderKey('openai')
  const google = getProviderKey('google')
  const deepseek = getProviderKey('deepseek')

  if (openai) env.OPENAI_API_KEY = openai
  if (google) {
    env.GOOGLE_GENERATIVE_AI_API_KEY = google
    env.GOOGLE_API_KEY = google
  }
  if (deepseek) env.DEEPSEEK_API_KEY = deepseek

  return env
}
