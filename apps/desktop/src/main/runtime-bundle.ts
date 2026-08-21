import { join } from 'node:path'
import { isPackagedRuntimeReady, resolvePackagedBundlePath } from './packaged-runtime-paths'

const RUNTIME_DIR_NAME = 'desktop-server'

/**
 * Packaged runtime root: server.cjs plus a node_modules holding only what could
 * not be bundled (native addons, jsdom). Nothing is unpacked at runtime.
 *
 * electron-builder's extraResources FileSet strips node_modules, so the tree is
 * copied into Resources by afterPack (scripts/desktop-after-pack.mjs).
 */
export function resolvePackagedRuntimeDir(): string {
  const runtimeDir = join(process.resourcesPath, RUNTIME_DIR_NAME)
  if (!isPackagedRuntimeReady(runtimeDir)) {
    throw new Error(
      `Packaged runtime incomplete: ${resolvePackagedBundlePath(runtimeDir)} is missing. ` +
        `Rebuild with scripts/pack-desktop-server.mjs.`
    )
  }
  return runtimeDir
}
