import { createConnection } from 'node:net'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import { app, net } from 'electron'
import type { SidecarHealth, SidecarStatus } from '../shared/sidecar-health'
import { DESKTOP_SERVER_PORT, LOG_PREFIX } from './sidecars-constants'
import {
  getRuntimeProfiles,
  ledgeindexDataDir,
  resolveApiOrigin,
  snapshotLedgeindexRuntimeEnv
} from './ledgeindex-runtime-env'
import {
  ensureProdDesktopServerExtracted,
  getExtractMessage,
  getExtractProgress
} from './runtime-bundle'

type WorkerMessage =
  | { type: 'ready' }
  | { type: 'error'; message: string }

let apiWorker: Worker | null = null
let listening = false
let status: SidecarStatus = 'idle'
let startPromise: Promise<void> | null = null

function resolveWorkerScriptPath(): string {
  return join(__dirname, 'ledgeindex-api-worker.js')
}

function resolvePackagedServerModulePath(runtimeRoot: string): string {
  return join(
    runtimeRoot,
    'node_modules',
    '@ledgeindex',
    'server',
    'dist',
    'index.js'
  )
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

export async function probeServerReady(timeoutMs = 2000): Promise<boolean> {
  const origin = resolveApiOrigin()
  if (await isReachable(`${origin}/health/packages`, timeoutMs)) return true
  return isReachable(`${origin}/health`, timeoutMs)
}

function isPortListening(port: number, timeoutMs = 400): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port })
    let settled = false
    const finish = (open: boolean): void => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(open)
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
  })
}

async function waitUntilPortFree(timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!(await isPortListening(DESKTOP_SERVER_PORT))) return
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error(`Port ${DESKTOP_SERVER_PORT} still in use after ${timeoutMs}ms`)
}

async function waitForWorkerReady(worker: Worker, timeoutMs = 180_000): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const deadline = Date.now() + timeoutMs
    let settled = false

    const finish = (error?: Error): void => {
      if (settled) return
      settled = true
      clearInterval(timer)
      worker.off('message', onMessage)
      worker.off('error', onError)
      worker.off('exit', onExit)
      if (error) reject(error)
      else resolve()
    }

    const onMessage = (message: WorkerMessage): void => {
      if (message.type === 'ready') finish()
      else if (message.type === 'error') finish(new Error(message.message))
    }

    const onError = (error: Error): void => {
      finish(error)
    }

    const onExit = (code: number): void => {
      if (code !== 0) finish(new Error(`API worker exited with code ${code}`))
    }

    const timer = setInterval(() => {
      if (Date.now() >= deadline) {
        finish(new Error(`API worker did not become ready within ${timeoutMs}ms`))
      }
    }, 500)

    worker.on('message', onMessage)
    worker.on('error', onError)
    worker.on('exit', onExit)
  })

  if (!(await probeServerReady(5_000))) {
    throw new Error(`API worker started but ${resolveApiOrigin()} is not reachable`)
  }
}

async function spawnApiWorker(): Promise<void> {
  let serverModulePath: string | undefined
  if (app.isPackaged) {
    status = 'extracting'
    const runtimeRoot = await ensureProdDesktopServerExtracted()
    serverModulePath = resolvePackagedServerModulePath(runtimeRoot)
  }

  status = 'starting'
  const worker = new Worker(resolveWorkerScriptPath(), {
    workerData: {
      env: snapshotLedgeindexRuntimeEnv(),
      serverModulePath,
      port: DESKTOP_SERVER_PORT,
      host: '127.0.0.1',
      dataDir: ledgeindexDataDir(),
      profiles: getRuntimeProfiles()
    }
  })

  apiWorker = worker
  worker.on('exit', (code) => {
    if (apiWorker === worker) {
      apiWorker = null
      listening = false
      if (status === 'ready' || status === 'starting') {
        status = code === 0 ? 'idle' : 'error'
      }
    }
  })

  await waitForWorkerReady(worker)
  listening = true
  status = 'ready'
  console.log(
    `[desktop] @ledgeindex/server ready in worker thread at ${resolveApiOrigin()}`
  )
}

/**
 * Start @ledgeindex/server in a dedicated worker thread.
 * HTTP on loopback (:3015) for UI + MCP; main process stays responsive.
 */
export async function ensureInProcessServerListening(): Promise<{
  spawned: boolean
  origin: string
}> {
  const origin = resolveApiOrigin()

  if (apiWorker && listening && (await probeServerReady())) {
    status = 'ready'
    return { spawned: false, origin }
  }

  if (startPromise) {
    await startPromise
    return { spawned: true, origin }
  }

  startPromise = (async () => {
    try {
      if (await isPortListening(DESKTOP_SERVER_PORT)) {
        if (await probeServerReady()) {
          listening = true
          status = 'ready'
          console.log(`[desktop] reusing existing listener on ${origin}`)
          return
        }
        console.warn(
          `[desktop] port ${DESKTOP_SERVER_PORT} held by unknown process — waiting…`
        )
        await waitUntilPortFree()
      }

      if (apiWorker) {
        await apiWorker.terminate()
        apiWorker = null
        listening = false
      }

      console.log(`[desktop] spawning API worker for ${origin}`)
      await spawnApiWorker()
    } catch (error) {
      status = 'error'
      listening = false
      if (apiWorker) {
        await apiWorker.terminate().catch(() => undefined)
        apiWorker = null
      }
      throw error
    } finally {
      startPromise = null
    }
  })()

  await startPromise
  return { spawned: true, origin }
}

export function getRuntimeStatus(): SidecarStatus {
  return status
}

export function setRuntimeStatus(next: SidecarStatus): void {
  status = next
}

export async function getInProcessServerHealth(): Promise<SidecarHealth> {
  const origin = resolveApiOrigin()
  const managedStatus = status
  const extractProgress = getExtractProgress()
  const extractMessage = getExtractMessage()
  const reachable =
    Boolean(apiWorker) && listening ? await probeServerReady() : false

  let effective: SidecarStatus
  if (reachable) {
    effective = 'ready'
    if (status !== 'ready') status = 'ready'
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
    setupProgress: effective === 'extracting' ? extractProgress : null,
    setupMessage:
      effective === 'extracting' || effective === 'starting'
        ? extractMessage
        : null
  }
}

export async function restartInProcessServer(): Promise<SidecarHealth> {
  await stopInProcessServer()
  status = 'idle'
  await new Promise((r) => setTimeout(r, 300))
  try {
    await ensureInProcessServerListening()
  } catch (error) {
    console.error(`[desktop] ${LOG_PREFIX} restart failed`, error)
    status = 'error'
  }
  return getInProcessServerHealth()
}

export async function stopInProcessServer(): Promise<void> {
  listening = false
  if (!apiWorker) {
    if (status !== 'starting') status = 'idle'
    return
  }
  console.log(`[desktop] stopping API worker`)
  const worker = apiWorker
  apiWorker = null
  try {
    await worker.terminate()
  } catch (error) {
    console.error(`[desktop] ${LOG_PREFIX} worker terminate failed`, error)
  }
  status = 'idle'
}
