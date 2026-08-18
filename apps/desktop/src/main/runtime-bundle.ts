import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

const ARCHIVE_NAME = 'desktop-server.tar'
const META_NAME = 'desktop-server.meta.json'
const VERSION_STAMP = '.ledgeindex-sidecar-version'
const BUNDLED_DIR_NAME = 'desktop-server'

let setupProgress: number | null = null
let setupMessage: string | null = null

export function getExtractProgress(): number | null {
  return setupProgress
}

export function getExtractMessage(): string | null {
  return setupMessage
}

function resolveSidecarArchivePath(): string {
  return join(process.resourcesPath, ARCHIVE_NAME)
}

function resolveSidecarMetaPath(): string {
  return join(process.resourcesPath, META_NAME)
}

function resolveBundledDesktopServerDir(): string {
  return join(process.resourcesPath, BUNDLED_DIR_NAME)
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

function resolveProdDesktopServerDir(): string {
  return join(app.getPath('userData'), 'desktop-server')
}

function assertProdDesktopServerReady(serverDir: string): void {
  const startJs = join(serverDir, 'dist', 'start.js')
  if (!existsSync(serverDir)) {
    throw new Error(
      `Packaged runtime missing at ${serverDir}. Expected extracted bundle (run pack + reinstall).`
    )
  }
  if (!existsSync(startJs)) {
    throw new Error(
      `Packaged runtime entry missing: ${startJs}. ` +
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
 * Packaged runtime root for @ledgeindex/* imports.
 * - macOS: exploded `Resources/desktop-server` (signed by electron-builder).
 * - Windows/Linux: extract `desktop-server.tar` into userData on first launch.
 */
export async function ensureProdDesktopServerExtracted(): Promise<string> {
  const bundledDir = resolveBundledDesktopServerDir()
  if (existsSync(join(bundledDir, 'dist', 'start.js'))) {
    console.log('[desktop] using bundled desktop-server at', bundledDir)
    setupProgress = null
    setupMessage = null
    assertProdDesktopServerReady(bundledDir)
    return bundledDir
  }

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

  if (!existsSync(archive)) {
    throw new Error(
      `Missing ${ARCHIVE_NAME} at ${archive} (and no bundled ${BUNDLED_DIR_NAME}/). ` +
        `Rebuild with pack-desktop-server.mjs.`
    )
  }

  const expectedFiles = readExpectedFileCount()
  setupProgress = expectedFiles ? 0 : null
  setupMessage = 'Unpacking runtime (first launch only)…'

  console.log('[desktop] extracting desktop-server archive…', {
    archive,
    runtimeDir,
    version,
    expectedFiles
  })

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
  setupMessage = 'Starting local API…'
  setupProgress = 100
  console.log('[desktop] runtime extract complete')
  return runtimeDir
}
