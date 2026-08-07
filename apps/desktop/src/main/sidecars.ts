import { execSync, spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app, net } from 'electron'
import type { SidecarHealth, SidecarStatus } from '../shared/sidecar-health'

/**
 * Sidecar = `@ledgeindex/desktop-server` (wraps `@ledgeindex/server`).
 *
 * Dedicated port — never share :3010 with web / AG / ledgeindex-api.
 * Never reuse an orphan process on our port; only the Electron-managed sidecar.
 */

/** Desktop-only API port (web/AG keep 3010). */
export const DESKTOP_SERVER_PORT = Number(
  process.env.LEDGEINDEX_DESKTOP_SERVER_PORT?.trim() || 3015
)

const LOG_PREFIX = 'desktop-server'

let sidecarProcess: ChildProcess | null = null
let spawnedByUs = false
let status: SidecarStatus = 'idle'
let startPromise: Promise<void> | null = null

export function resolveApiOrigin(): string {
  return `http://127.0.0.1:${DESKTOP_SERVER_PORT}`
}

export function getSidecarStatus(): SidecarStatus {
  return status
}

function resolveDesktopServerDevDir(): string {
  const candidates = [
    join(__dirname, '..', '..', '..', '..', 'hosts', 'desktop-server'),
    join(app.getAppPath(), '..', 'hosts', 'desktop-server'),
    join(app.getAppPath(), '..', '..', 'hosts', 'desktop-server'),
    join(process.cwd(), 'ledgeindex', 'hosts', 'desktop-server'),
    join(process.cwd(), 'hosts', 'desktop-server')
  ]

  for (const dir of candidates) {
    if (existsSync(join(dir, 'package.json')) && existsSync(join(dir, 'src', 'start.ts'))) {
      return dir
    }
  }

  return candidates[0]
}

function resolveProdDesktopServerDir(): string {
  return join(process.resourcesPath, 'desktop-server')
}

/** Fail fast with a clear message instead of Node's opaque ENOENT on missing cwd. */
function assertProdDesktopServerReady(serverDir: string): void {
  const startJs = join(serverDir, 'dist', 'start.js')
  if (!existsSync(serverDir)) {
    throw new Error(
      `Packaged desktop-server missing at ${serverDir}. ` +
        `Expected electron-builder extraResources (run: node scripts/pack-desktop-server.mjs before packaging).`
    )
  }
  if (!existsSync(startJs)) {
    throw new Error(
      `Packaged desktop-server entry missing: ${startJs}. ` +
        `Rebuild the sidecar (node scripts/pack-desktop-server.mjs) and re-package the app.`
    )
  }
}

function ledgeindexDataDir(): string {
  return join(app.getPath('userData'), 'ledgeindex')
}

import { buildProviderEnv } from './provider-settings'

function resolveRemotePlatformApiUrl(): string | undefined {
  const candidates = [
    process.env.LEDGEINDEX_REMOTE_API_URL,
    process.env.NEXT_PUBLIC_LEDGEINDEX_REMOTE_API_URL,
    process.env.NEXT_PUBLIC_KNOWLEDGEINDEX_REMOTE_API_URL,
  ]
  for (const value of candidates) {
    const trimmed = value?.trim()
    if (trimmed) return trimmed.replace(/\/$/, '')
  }
  return undefined
}

function buildSidecarEnv(): NodeJS.ProcessEnv {
  const origin = resolveApiOrigin()
  const remoteApi = resolveRemotePlatformApiUrl()
  return {
    ...process.env,
    ...buildProviderEnv(),
    PORT: String(DESKTOP_SERVER_PORT),
    HOST: '127.0.0.1',
    // MCP OAuth discovery / Cursor mcp.json must advertise this origin.
    MASTRA_PUBLIC_URL: origin,
    LEDGEINDEX_API_BASE: origin,
    LEDGEINDEX_API_URL: origin,
    // Do not inherit web's NEXT_PUBLIC_* API URL (usually :3010).
    NEXT_PUBLIC_LEDGEINDEX_API_URL: origin,
    NEXT_PUBLIC_KNOWLEDGEINDEX_API_URL: origin,
    // Hosted / Public corpus for list_platform_sources + ask_source proxy.
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
    LEDGEINDEX_LOCAL_USER_ID: process.env.LEDGEINDEX_LOCAL_USER_ID ?? 'ledgeindex-desktop-local'
  }
}

async function isReachable(url: string, timeoutMs = 2000): Promise<boolean> {
  try {
    const res = await net.fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs)
    })
    return res.ok
  } catch {
    return false
  }
}

async function probeServerReady(timeoutMs = 2000): Promise<boolean> {
  const origin = resolveApiOrigin()
  if (await isReachable(`${origin}/health/packages`, timeoutMs)) return true
  return isReachable(`${origin}/health`, timeoutMs)
}

function isPortListeningSync(port: number): boolean {
  try {
    if (process.platform === 'win32') {
      const out = execSync(`netstat -ano | findstr :${port}`, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 3_000,
        windowsHide: true
      })
      return /LISTENING/i.test(out)
    }
    const out = execSync(`lsof -nP -iTCP:${port} -sTCP:LISTEN`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 3_000
    })
    return out.trim().length > 0
  } catch {
    return false
  }
}

function freeDesktopServerPortIfNeeded(): void {
  if (app.isPackaged) return

  const listening = isPortListeningSync(DESKTOP_SERVER_PORT)
  // Health can succeed from an orphan even when netstat briefly looks empty.
  // Always clear the port in that case before we spawn our managed process.
  console.log(
    '[desktop]',
    listening ? 'freeing dedicated port' : 'ensuring dedicated port is clear',
    DESKTOP_SERVER_PORT
  )
  try {
    execSync(`npx --yes kill-port ${DESKTOP_SERVER_PORT}`, {
      stdio: 'ignore',
      // execSync types require a shell path (boolean is only valid for spawn).
      shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh',
      timeout: 15_000
    })
  } catch {
    // Port may already be free.
  }

  if (process.platform === 'win32') {
    try {
      execSync(
        `powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort ${DESKTOP_SERVER_PORT} -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }"`,
        { stdio: 'ignore', timeout: 10_000, windowsHide: true }
      )
    } catch {
      // Port may already be free.
    }
  }
}

async function waitUntilDesktopPortFree(timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const listening = isPortListeningSync(DESKTOP_SERVER_PORT)
    const healthy = await probeServerReady(400)
    if (!listening && !healthy) return
    await new Promise((r) => setTimeout(r, 200))
  }
  console.warn(
    '[desktop] port',
    DESKTOP_SERVER_PORT,
    'still busy after cleanup — spawn may fail with EADDRINUSE'
  )
}

function logService(chunk: Buffer, stream: 'out' | 'err'): void {
  const text = chunk.toString('utf8').trimEnd()
  if (!text) return
  const prefix = stream === 'err' ? `[${LOG_PREFIX}:err]` : `[${LOG_PREFIX}]`
  for (const line of text.split(/\r?\n/)) {
    console.log(prefix, line)
  }
}

function killSidecarProcessTree(child: ChildProcess): void {
  if (!child.pid) {
    child.kill()
    return
  }
  if (process.platform === 'win32') {
    try {
      execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: 'ignore' })
    } catch {
      child.kill()
    }
    return
  }
  child.kill('SIGTERM')
}

function attachSidecarLogs(child: ChildProcess): void {
  child.stdout?.on('data', (chunk: Buffer) => logService(chunk, 'out'))
  child.stderr?.on('data', (chunk: Buffer) => logService(chunk, 'err'))
  child.on('exit', (code, signal) => {
    console.log(`[desktop] @ledgeindex/desktop-server exited`, { code, signal })
    if (sidecarProcess === child) {
      sidecarProcess = null
      spawnedByUs = false
      if (status !== 'starting') {
        status = code === 0 ? 'idle' : 'error'
      }
    }
  })
}

/**
 * Wait until OUR child owns the port. Ignore early health hits that can
 * belong to a dying orphan, and fail if our process exits (EADDRINUSE etc.).
 */
async function waitForReady(timeoutMs = 180_000): Promise<void> {
  const spawnedAt = Date.now()
  // Don't accept /health from a previous process that hasn't released yet.
  const ignoreHealthUntil = spawnedAt + 1_500
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    const child = sidecarProcess
    if (child && child.exitCode !== null) {
      throw new Error(
        `@ledgeindex/desktop-server exited before ready (code ${child.exitCode}). Check [${LOG_PREFIX}] logs.`
      )
    }
    if (Date.now() >= ignoreHealthUntil && (await probeServerReady())) {
      // Confirm our managed child is still alive (not an orphan we mistook).
      if (child && child.exitCode === null) return
    }
    await new Promise((r) => setTimeout(r, 400))
  }
  throw new Error(
    `@ledgeindex/desktop-server did not become ready at ${resolveApiOrigin()} within ${timeoutMs}ms`
  )
}

async function spawnServerSidecar(): Promise<void> {
  status = 'starting'

  if (!app.isPackaged) {
    freeDesktopServerPortIfNeeded()
    await waitUntilDesktopPortFree()
    // Windows can keep the socket in TIME_WAIT briefly after kill.
    await new Promise((r) => setTimeout(r, 350))
  }

  if (app.isPackaged) {
    const serverDir = resolveProdDesktopServerDir()
    assertProdDesktopServerReady(serverDir)
    console.log('[desktop] spawning packaged @ledgeindex/desktop-server', {
      dir: serverDir,
      port: DESKTOP_SERVER_PORT
    })
    sidecarProcess = spawn(process.execPath, ['dist/start.js'], {
      cwd: serverDir,
      env: {
        ...buildSidecarEnv(),
        ELECTRON_RUN_AS_NODE: '1',
        NODE_ENV: 'production'
      },
      stdio: ['ignore', 'pipe', 'pipe']
    })
  } else {
    const serverDir = resolveDesktopServerDevDir()
    console.log('[desktop] spawning @ledgeindex/desktop-server (npm run dev:sidecar)', {
      dir: serverDir,
      port: DESKTOP_SERVER_PORT
    })
    sidecarProcess = spawn('npm', ['run', 'dev:sidecar'], {
      cwd: serverDir,
      env: buildSidecarEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true
    })
  }

  spawnedByUs = true
  attachSidecarLogs(sidecarProcess)
  await waitForReady()
  status = 'ready'
  console.log('[desktop] @ledgeindex/desktop-server ready at', resolveApiOrigin())
}

/**
 * Always run our own managed desktop-server.
 * Never attach to web/AG/:3010 or any orphan on our dedicated port.
 */
export async function ensureApiRunning(): Promise<{ spawned: boolean; origin: string }> {
  const origin = resolveApiOrigin()

  if (spawnedByUs && sidecarProcess && !sidecarProcess.killed && (await probeServerReady())) {
    status = 'ready'
    return { spawned: false, origin }
  }

  if (startPromise) {
    await startPromise
    return { spawned: true, origin }
  }

  startPromise = (async () => {
    try {
      await spawnServerSidecar()
    } catch (error) {
      status = 'error'
      throw error
    } finally {
      startPromise = null
    }
  })()

  await startPromise
  return { spawned: true, origin }
}

export async function getSidecarHealth(): Promise<SidecarHealth> {
  const origin = resolveApiOrigin()
  const managedStatus = status
  const ownsProcess = Boolean(spawnedByUs && sidecarProcess && !sidecarProcess.killed)
  const reachable = ownsProcess ? await probeServerReady() : false

  let effective: SidecarStatus
  if (reachable) {
    effective = 'ready'
    if (status !== 'ready') status = 'ready'
  } else if (managedStatus === 'starting') {
    effective = 'starting'
  } else if (managedStatus === 'error') {
    effective = 'error'
  } else {
    effective = 'idle'
  }

  return {
    status: effective,
    managedStatus,
    reachable,
    origin,
    port: DESKTOP_SERVER_PORT
  }
}

export async function restartDesktopSidecar(): Promise<SidecarHealth> {
  stopDesktopSidecars()
  status = 'idle'
  await new Promise((r) => setTimeout(r, 400))
  try {
    await ensureApiRunning()
  } catch (error) {
    console.error('[desktop] sidecar restart failed', error)
    status = 'error'
  }
  return getSidecarHealth()
}

export function stopDesktopSidecars(): void {
  if (!spawnedByUs || !sidecarProcess || sidecarProcess.killed) {
    if (!spawnedByUs) status = 'idle'
    return
  }
  const child = sidecarProcess
  console.log('[desktop] stopping @ledgeindex/desktop-server', { pid: child.pid })
  sidecarProcess = null
  spawnedByUs = false
  status = 'idle'
  killSidecarProcessTree(child)
}
