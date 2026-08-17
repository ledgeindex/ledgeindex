/**
 * Local API lifecycle — @ledgeindex/server runs in-process (Electron main), not a child sidecar.
 */
import type { SidecarHealth, SidecarStatus } from '../shared/sidecar-health'
import {
  ensureInProcessServerListening,
  getInProcessServerHealth,
  getRuntimeStatus,
  restartInProcessServer,
  stopInProcessServer
} from './in-process-server'

export { DESKTOP_SERVER_PORT } from './sidecars-constants'
export { resolveApiOrigin } from './ledgeindex-runtime-env'

export function getSidecarStatus(): SidecarStatus {
  return getRuntimeStatus()
}

export async function ensureApiRunning(): Promise<{ spawned: boolean; origin: string }> {
  return ensureInProcessServerListening()
}

export async function getSidecarHealth(): Promise<SidecarHealth> {
  return getInProcessServerHealth()
}

export async function restartDesktopSidecar(): Promise<SidecarHealth> {
  return restartInProcessServer()
}

export function stopDesktopSidecars(): Promise<void> {
  return stopInProcessServer()
}
