import { execSync, spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, net } from 'electron'
import type { SidecarHealth, SidecarStatus } from '../shared/sidecar-health'

/**
 * Sidecar = `@ledgeindex/desktop-server` (wraps `@ledgeindex/server`).
 *
 * Dedicated port — never share :3010 with web / AG / ledgeindex-api.
 * Never reuse an orphan process on our port; only the Electron-managed sidecar.
 *
 * Packaged layout: installer ships resources/desktop-server.tar (one file).
 * First launch extracts into userData/desktop-server so NSIS does not copy
 * ~50k node_modules files (that made installs take many minutes).
 */

/** Desktop-only API port (web/AG keep 3010). */
export const DESKTOP_SERVER_PORT = Number(
  process.env.LEDGEINDEX_DESKTOP_SERVER_PORT?.trim() || 3015
)

const LOG_PREFIX = 'desktop-server'
const ARCHIVE_NAME = 'desktop-server.tar'
const META_NAME = 'desktop-server.meta.json'
const VERSION_STAMP = '.ledgeindex-sidecar-version'

let sidecarProcess: ChildProcess | null = null
let spawnedByUs = false
let status: SidecarStatus = 'idle'
let startPromise: Promise<void> | null = null
/** First-launch extract progress (0–100), null when not extracting / unknown. */
let setupProgress: number | null = null
let setupMessage: string | null = null

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

function resolveSidecarArchivePath(): string {
  return join(process.resourcesPath, ARCHIVE_NAME)
}

function resolveSidecarMetaPath(): string {
  return join(process.resourcesPath, META_NAME)
}

function readExpectedFileCount(): number | null {
  try {
    const metaPath = resolveSidecarMetaPath()
    if (!existsSync(metaPath)) return null
    const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as { fileCount?: number }
    return typeof meta.fileCount === 'number' && meta.fileCount > 0 ? meta.fileCount : null
  } catch {
    return null
  }
}

/** Runtime cwd for packaged sidecar (extracted tree, writable). */
function resolveProdDesktopServerDir(): string {
  return join(app.getPath('userData'), 'desktop-server')
}

/** Fail fast with a clear message instead of Node's opaque ENOENT on missing cwd. */
function assertProdDesktopServerReady(serverDir: string): void {
  const startJs = join(serverDir, 'dist', 'start.js')
  if (!existsSync(serverDir)) {
    throw new Error(
      `Packaged desktop-server missing at ${serverDir}. ` +
        `Expected extracted sidecar (run pack + reinstall).`
    )
  }
  if (!existsSync(startJs)) {
    throw new Error(
      `Packaged desktop-server entry missing: ${startJs}. ` +
        `Delete %APPDATA%\\ledgeindex-desktop\\desktop-server and restart to re-extract.`
    )
  }
}

function extractTarWithProgress(
  archive: string,
  runtimeDir: string,
  expectedFiles: number | null
): Promise<void> {
  return new Promise((resolve, reject) => {
    let extracted = 0
    const bump = (): void => {
      extracted += 1
      if (expectedFiles && expectedFiles > 0) {
        setupProgress = Math.min(99, Math.round((extracted / expectedFiles) * 100))
      }
    }

    // Prefer argv form (no shell) so -xvf works consistently on Windows bsdtar.
    const child = spawn('tar', ['-xvf', archive, '-C', runtimeDir], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })

    const onChunk = (chunk: Buffer): void => {
      const text = chunk.toString('utf8')
      for (const line of text.split(/\r?\n/)) {
        if (line.trim()) bump()
      }
    }
    child.stdout?.on('data', onChunk)
    child.stderr?.on('data', onChunk)

    child.on('error', (error) => {
      reject(error)
    })
    child.on('close', (code) => {
      if (code === 0) {
        setupProgress = 100
        resolve()
        return
      }
      reject(new Error(`tar extract failed with code ${code}`))
    })
  })
}

/**
 * Ensure the sidecar tree exists under userData. Installer only ships a .tar.
 */
async function ensureProdDesktopServerExtracted(): Promise<string> {
  const runtimeDir = resolveProdDesktopServerDir()
  const archive = resolveSidecarArchivePath()
  const stampPath = join(runtimeDir, VERSION_STAMP)
  const version = app.getVersion()
  const startJs = join(runtimeDir, 'dist', 'start.js')

  let needExtract = !existsSync(startJs)
  if (!needExtract) {
    try {
      const stamped = existsSync(stampPath) ? readFileSync(stampPath, 'utf8').trim() : ''
      if (stamped !== version) needExtract = true
    } catch {
      needExtract = true
    }
  }

  if (!needExtract) {
    setupProgress = null
    setupMessage = null
    assertProdDesktopServerReady(runtimeDir)
    return runtimeDir
  }

  // Legacy installers shipped an exploded resources/desktop-server tree.
  const legacyDir = join(process.resourcesPath, 'desktop-server')
  if (!existsSync(archive) && existsSync(join(legacyDir, 'dist', 'start.js'))) {
    console.log('[desktop] using legacy exploded desktop-server at', legacyDir)
    setupProgress = null
    setupMessage = null
    return legacyDir
  }

  if (!existsSync(archive)) {
    throw new Error(
      `Missing ${ARCHIVE_NAME} at ${archive}. ` +
        `Rebuild with pack-desktop-server.mjs (creates build/desktop-server.tar).`
    )
  }

  const expectedFiles = readExpectedFileCount()
  status = 'extracting'
  setupProgress = expectedFiles ? 0 : null
  setupMessage = 'Unpacking local server (first launch only)…'

  console.log(
    '[desktop] extracting desktop-server archive (first run or version change)…',
    { archive, runtimeDir, version, expectedFiles }
  )

  rmSync(runtimeDir, { recursive: true, force: true })
  mkdirSync(runtimeDir, { recursive: true })

  try {
    await extractTarWithProgress(archive, runtimeDir, expectedFiles)
  } catch (error) {
    setupMessage = 'Setup failed while unpacking'
    throw error
  }

  writeFileSync(stampPath, `${version}\n`, 'utf8')
  assertProdDesktopServerReady(runtimeDir)
  setupMessage = 'Starting local server…'
  setupProgress = 100
  console.log('[desktop] desktop-server extract complete')
  return runtimeDir
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

/** Recent stderr lines kept so early crash errors surface in waitForReady. */
let recentSidecarStderr = ''

function attachSidecarLogs(child: ChildProcess): void {
  recentSidecarStderr = ''
  child.stdout?.on('data', (chunk: Buffer) => logService(chunk, 'out'))
  child.stderr?.on('data', (chunk: Buffer) => {
    const text = chunk.toString('utf8')
    recentSidecarStderr = `${recentSidecarStderr}${text}`.slice(-4000)
    logService(chunk, 'err')
  })
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
      const stderrTail = recentSidecarStderr.trim().slice(-1500)
      throw new Error(
        `@ledgeindex/desktop-server exited before ready (code ${child.exitCode}).` +
          (stderrTail
            ? `\n--- sidecar stderr ---\n${stderrTail}\n---`
            : ` Check [${LOG_PREFIX}] logs.`)
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
  if (!app.isPackaged) {
    status = 'starting'
    freeDesktopServerPortIfNeeded()
    await waitUntilDesktopPortFree()
    // Windows can keep the socket in TIME_WAIT briefly after kill.
    await new Promise((r) => setTimeout(r, 350))
  }

  if (app.isPackaged) {
    const serverDir = await ensureProdDesktopServerExtracted()
    status = 'starting'
    setupMessage = 'Starting local server…'
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
    setupProgress = null
    setupMessage = null
  } else if (managedStatus === 'extracting') {
    effective = 'extracting'
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
    port: DESKTOP_SERVER_PORT,
    setupProgress: effective === 'extracting' ? setupProgress : null,
    setupMessage:
      effective === 'extracting' || effective === 'starting' ? setupMessage : null
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
