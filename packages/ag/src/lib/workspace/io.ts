import { existsSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'fs'
import { basename, dirname, join, resolve } from 'path'
import {
  collectWorkspaceFilePaths,
  collectWorkspaceTabDirs,
  createDefaultWorkspaceDoc,
  parseWorkspaceDocument,
  type WorkspaceDocument
} from './schema'

export const WORKSPACE_NOTE_MAX_CHARS = 10_000

export function clampWorkspaceNoteContent(markdown: string): string {
  if (markdown.length <= WORKSPACE_NOTE_MAX_CHARS) return markdown
  return markdown.slice(0, WORKSPACE_NOTE_MAX_CHARS)
}

export function getWorkspaceRootFromEnv(): string {
  const root = process.env.AUTOMATIONGHOST_WORKSPACE_ROOT?.trim()
  if (!root) {
    throw new Error('AUTOMATIONGHOST_WORKSPACE_ROOT is not set')
  }
  return root
}

export function resolveWorkspaceRoot(override?: string | null): string {
  const trimmed = override?.trim()
  if (trimmed) return trimmed
  return getWorkspaceRootFromEnv()
}

function workspaceDocumentPath(root: string): string {
  return join(root, 'workspace.json')
}

function workspacePagesDir(root: string): string {
  const dir = join(root, 'pages')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

export function resolveWorkspacePagePath(root: string, relativePath: string): string | null {
  if (!relativePath.startsWith('pages/')) return null
  const safeName = relativePath.replace(/\\/g, '/')
  if (safeName.includes('..')) return null
  const resolvedRoot = resolve(root)
  const full = resolve(join(resolvedRoot, safeName))
  if (!full.startsWith(resolvedRoot)) return null
  return full
}

function resolveWorkspacePageDir(root: string, channelSlug: string): string | null {
  const slug = basename(channelSlug)
  if (!slug || slug !== channelSlug) return null
  const pagesRoot = resolve(workspacePagesDir(root))
  const full = resolve(join(pagesRoot, slug))
  if (!full.startsWith(pagesRoot)) return null
  return full
}

export function readWorkspacePage(root: string, relativePath: string): string {
  const full = resolveWorkspacePagePath(root, relativePath)
  if (!full || !existsSync(full)) return ''
  try {
    return readFileSync(full, 'utf8')
  } catch {
    return ''
  }
}

export function writeWorkspacePage(root: string, relativePath: string, content: string): void {
  const full = resolveWorkspacePagePath(root, relativePath)
  if (!full) throw new Error(`Invalid page path: ${relativePath}`)
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, clampWorkspaceNoteContent(content), 'utf8')
}

function ensureWorkspacePage(root: string, relativePath: string, content = ''): void {
  const full = resolveWorkspacePagePath(root, relativePath)
  if (!full) throw new Error(`Invalid page path: ${relativePath}`)
  if (existsSync(full)) return
  writeWorkspacePage(root, relativePath, content)
}

function deleteWorkspacePage(root: string, relativePath: string): void {
  const full = resolveWorkspacePagePath(root, relativePath)
  if (!full || !existsSync(full)) return
  unlinkSync(full)
}

function deleteWorkspaceTabDir(root: string, channelSlug: string, tabSlug: string): void {
  const channelDir = resolveWorkspacePageDir(root, channelSlug)
  if (!channelDir) return
  const tabDir = join(channelDir, tabSlug)
  if (!existsSync(tabDir)) return
  rmSync(tabDir, { recursive: true, force: true })
}

function deleteWorkspaceChannelPages(root: string, channelSlug: string): void {
  const dir = resolveWorkspacePageDir(root, channelSlug)
  if (!dir || !existsSync(dir)) return
  rmSync(dir, { recursive: true, force: true })
}

export function syncWorkspacePages(
  root: string,
  prev: WorkspaceDocument | null,
  next: WorkspaceDocument
): void {
  const prevPaths = prev ? collectWorkspaceFilePaths(prev) : new Set<string>()
  const nextPaths = collectWorkspaceFilePaths(next)

  for (const path of prevPaths) {
    if (!nextPaths.has(path)) deleteWorkspacePage(root, path)
  }
  for (const path of nextPaths) {
    ensureWorkspacePage(root, path, '')
  }

  const prevTabDirs = prev ? collectWorkspaceTabDirs(prev) : new Set<string>()
  const nextTabDirs = collectWorkspaceTabDirs(next)
  for (const dir of prevTabDirs) {
    if (!nextTabDirs.has(dir)) {
      const [, channelSlug, tabSlug] = dir.split('/')
      if (channelSlug && tabSlug) deleteWorkspaceTabDir(root, channelSlug, tabSlug)
    }
  }

  const prevSlugs = new Set(prev?.channels.map((c) => c.slug) ?? [])
  const nextSlugs = new Set(next.channels.map((c) => c.slug))
  for (const slug of prevSlugs) {
    if (!nextSlugs.has(slug)) deleteWorkspaceChannelPages(root, slug)
  }
}

export function readWorkspaceDocument(root: string): WorkspaceDocument {
  const path = workspaceDocumentPath(root)
  if (!existsSync(path)) {
    const doc = createDefaultWorkspaceDoc()
    saveWorkspaceDocument(root, doc, null)
    return doc
  }
  const raw = JSON.parse(readFileSync(path, 'utf8'))
  const parsed = parseWorkspaceDocument(raw)
  if (!parsed) throw new Error('Invalid workspace.json')
  return parsed
}

export function saveWorkspaceDocument(
  root: string,
  doc: WorkspaceDocument,
  prev: WorkspaceDocument | null
): WorkspaceDocument {
  const next: WorkspaceDocument = {
    ...doc,
    updatedAt: new Date().toISOString()
  }
  syncWorkspacePages(root, prev, next)
  mkdirSync(root, { recursive: true })
  writeFileSync(workspaceDocumentPath(root), JSON.stringify(next, null, 2), 'utf8')
  return next
}
