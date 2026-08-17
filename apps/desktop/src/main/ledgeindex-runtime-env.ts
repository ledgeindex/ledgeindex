import { join } from 'node:path'
import { app } from 'electron'
import { DESKTOP_SERVER_PORT } from './sidecars-constants'
import { buildProviderEnv } from './provider-settings'

export function ledgeindexDataDir(): string {
  return join(app.getPath('userData'), 'ledgeindex')
}

export function resolveApiOrigin(): string {
  return `http://127.0.0.1:${DESKTOP_SERVER_PORT}`
}

function resolveRemotePlatformApiUrl(): string | undefined {
  const candidates = [
    process.env.LEDGEINDEX_REMOTE_API_URL,
    process.env.NEXT_PUBLIC_LEDGEINDEX_REMOTE_API_URL,
    process.env.NEXT_PUBLIC_KNOWLEDGEINDEX_REMOTE_API_URL
  ]
  for (const value of candidates) {
    const trimmed = value?.trim()
    if (trimmed) return trimmed.replace(/\/$/, '')
  }
  return undefined
}

/** Env for @ledgeindex/server — same keys the sidecar child used. */
export function applyLedgeindexRuntimeEnv(): void {
  const origin = resolveApiOrigin()
  const remoteApi = resolveRemotePlatformApiUrl()
  const merged = {
    ...process.env,
    ...buildProviderEnv(),
    PORT: String(DESKTOP_SERVER_PORT),
    HOST: '127.0.0.1',
    MASTRA_PUBLIC_URL: origin,
    LEDGEINDEX_API_BASE: origin,
    LEDGEINDEX_API_URL: origin,
    NEXT_PUBLIC_LEDGEINDEX_API_URL: origin,
    NEXT_PUBLIC_KNOWLEDGEINDEX_API_URL: origin,
    ...(remoteApi
      ? {
          LEDGEINDEX_REMOTE_API_URL: remoteApi,
          NEXT_PUBLIC_LEDGEINDEX_REMOTE_API_URL: remoteApi,
          NEXT_PUBLIC_KNOWLEDGEINDEX_REMOTE_API_URL: remoteApi
        }
      : {}),
    LEDGEINDEX_PROFILES: process.env.LEDGEINDEX_PROFILES?.trim() || 'docs,profile',
    LEDGEINDEX_DATA_DIR: ledgeindexDataDir(),
    LEDGEINDEX_AUTH_REQUIRED: process.env.LEDGEINDEX_AUTH_REQUIRED ?? '0',
    LEDGEINDEX_LOCAL_USER_ID:
      process.env.LEDGEINDEX_LOCAL_USER_ID ?? 'ledgeindex-desktop-local'
  }
  for (const [key, value] of Object.entries(merged)) {
    if (value !== undefined) process.env[key] = value
  }
}

function parseProfiles(): Array<'docs' | 'profile'> {
  const raw = process.env.LEDGEINDEX_PROFILES ?? 'docs,profile'
  return raw
    .split(',')
    .map((p) => p.trim())
    .map((p) => (p === 'company' ? 'profile' : p))
    .filter((p): p is 'docs' | 'profile' => p === 'docs' || p === 'profile')
}

export function getRuntimeProfiles(): Array<'docs' | 'profile'> {
  return parseProfiles()
}

/** Copy env into a plain object for worker_threads workerData. */
export function snapshotLedgeindexRuntimeEnv(): Record<string, string> {
  applyLedgeindexRuntimeEnv()
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string') out[key] = value
  }
  return out
}
