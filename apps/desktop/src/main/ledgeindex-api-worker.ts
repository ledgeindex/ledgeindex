/**
 * Runs @ledgeindex/server in a worker thread so crawl/index/embeddings
 * do not block the Electron main process (window IPC, tray, etc.).
 */
import { dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parentPort, workerData } from 'node:worker_threads'
import type { FastifyInstance } from 'fastify'

type DesktopRuntime = {
  createLedgeIndexServer: typeof import('@ledgeindex/server').createLedgeIndexServer
  firebaseAuthMiddleware: Parameters<FastifyInstance['register']>[0]
}

type ApiWorkerData = {
  env: Record<string, string>
  /** Packaged: absolute path to the bundled server (server.cjs) */
  runtimeBundlePath?: string
  /** Packaged: Resources/desktop-server. Dev: hosts/desktop-server. */
  runtimeRoot?: string
  /** Absolute path to discover-header-nav-child.js for forked Stagehand runs. */
  headerNavChildScript?: string
  port: number
  host: string
  dataDir: string
  profiles: Array<'docs' | 'profile'>
}

function applyEnv(env: Record<string, string>): void {
  for (const [key, value] of Object.entries(env)) {
    process.env[key] = value
  }
}

/**
 * Packaged builds load one bundle that exports the whole surface. In dev the
 * workspace packages are resolvable directly, so import them by name.
 */
async function loadRuntime(bundlePath?: string): Promise<DesktopRuntime> {
  if (bundlePath) {
    return (await import(pathToFileURL(bundlePath).href)) as DesktopRuntime
  }
  const [server, auth] = await Promise.all([
    import('@ledgeindex/server'),
    import('@ledgeindex/docs/runtime/middleware/firebase-auth.js'),
  ])
  return {
    createLedgeIndexServer: server.createLedgeIndexServer,
    firebaseAuthMiddleware: auth.default as Parameters<FastifyInstance['register']>[0],
  }
}

function applyRuntimeRoot(data: ApiWorkerData): void {
  const root =
    data.runtimeRoot?.trim() ||
    (data.runtimeBundlePath ? dirname(data.runtimeBundlePath) : undefined)
  if (root) process.env.LEDGEINDEX_RUNTIME_ROOT = root
  const child = data.headerNavChildScript?.trim()
  if (child) process.env.LEDGEINDEX_HEADER_NAV_CHILD = child
}

async function run(): Promise<void> {
  const data = workerData as ApiWorkerData
  applyEnv(data.env)
  applyRuntimeRoot(data)

  const { createLedgeIndexServer, firebaseAuthMiddleware } = await loadRuntime(
    data.runtimeBundlePath,
  )

  const server = await createLedgeIndexServer({
    profiles: data.profiles,
    port: data.port,
    host: data.host,
    dataDir: data.dataDir,
    beforeProfiles: async (app) => {
      await app.register(firebaseAuthMiddleware)
    },
  })

  await server.listen()
  parentPort?.postMessage({ type: 'ready' })
}

void run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  parentPort?.postMessage({ type: 'error', message })
})
