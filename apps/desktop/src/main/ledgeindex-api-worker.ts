/**
 * Runs @ledgeindex/server in a worker thread so crawl/index/embeddings
 * do not block the Electron main process (window IPC, tray, etc.).
 */
import { parentPort, workerData } from 'node:worker_threads'
import type { FastifyInstance } from 'fastify'

type ApiWorkerData = {
  env: Record<string, string>
  /** Packaged: absolute path to @ledgeindex/server dist entry */
  serverModulePath?: string
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

async function registerDesktopAuth(appInstance: FastifyInstance): Promise<void> {
  const firebaseAuthMiddleware = (
    await import('@ledgeindex/docs/runtime/middleware/firebase-auth.js')
  ).default
  await appInstance.register(firebaseAuthMiddleware)
}

async function run(): Promise<void> {
  const data = workerData as ApiWorkerData
  applyEnv(data.env)

  const serverModule = data.serverModulePath
    ? await import(data.serverModulePath)
    : await import('@ledgeindex/server')

  const { createLedgeIndexServer } = serverModule as typeof import('@ledgeindex/server')
  const server = await createLedgeIndexServer({
    profiles: data.profiles,
    port: data.port,
    host: data.host,
    dataDir: data.dataDir,
    beforeProfiles: registerDesktopAuth
  })

  await server.listen()
  parentPort?.postMessage({ type: 'ready' })
}

void run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  parentPort?.postMessage({ type: 'error', message })
})
