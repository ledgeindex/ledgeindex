import { existsSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The packaged server is a single bundled file (scripts/bundle-desktop-server.mjs).
 * It exports both the server factory and the auth middleware, so the worker
 * loads one module instead of resolving a node_modules tree.
 */
export const PACKAGED_BUNDLE_REL = 'server.cjs'

export function resolvePackagedBundlePath(runtimeRoot: string): string {
  return join(runtimeRoot, PACKAGED_BUNDLE_REL)
}

export function isPackagedRuntimeReady(runtimeRoot: string): boolean {
  return existsSync(resolvePackagedBundlePath(runtimeRoot))
}
