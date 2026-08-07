/** Brain workspace schema — kept in sync with automationghost-electron shared/workspace-schema.ts */

export type WorkspaceUnit = {
  id: string
  title: string
  order: number
  filePath: string
}

export type WorkspaceTab = {
  id: string
  title: string
  slug: string
  order: number
  units: WorkspaceUnit[]
}

export type WorkspaceChannel = {
  id: string
  name: string
  slug: string
  order: number
  tabs: WorkspaceTab[]
}

export type WorkspaceDocument = {
  id: string
  name: string
  channels: WorkspaceChannel[]
  ui: {
    activeChannelId: string | null
    activeTabIdByChannel: Record<string, string>
    channelsSidebarOpen: boolean
  }
  createdAt: string
  updatedAt: string
}

export function slugifyWorkspaceSegment(name: string): string {
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'untitled'
}

export function newChannelId(): string {
  return `ch_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export function newTabId(): string {
  return `tab_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export function newUnitId(): string {
  return `unit_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export function sortUnits(units: WorkspaceUnit[]): WorkspaceUnit[] {
  return [...units].sort((a, b) => a.order - b.order)
}

export function sortTabs(tabs: WorkspaceTab[]): WorkspaceTab[] {
  return [...tabs].sort((a, b) => a.order - b.order)
}

export function sortChannels(channels: WorkspaceChannel[]): WorkspaceChannel[] {
  return [...channels].sort((a, b) => a.order - b.order)
}

export function collectWorkspaceFilePaths(doc: Pick<WorkspaceDocument, 'channels'>): Set<string> {
  const paths = new Set<string>()
  for (const channel of doc.channels) {
    for (const tab of channel.tabs) {
      for (const unit of tab.units ?? []) {
        if (unit.filePath) paths.add(unit.filePath)
      }
    }
  }
  return paths
}

export function collectWorkspaceTabDirs(doc: Pick<WorkspaceDocument, 'channels'>): Set<string> {
  const dirs = new Set<string>()
  for (const channel of doc.channels) {
    for (const tab of channel.tabs) {
      if (channel.slug && tab.slug) {
        dirs.add(`pages/${channel.slug}/${tab.slug}`)
      }
    }
  }
  return dirs
}

export function allocateUnitPath(
  channelSlug: string,
  tabSlug: string,
  unitTitle: string,
  usedPaths: Iterable<string>
): string {
  const used = new Set(usedPaths)
  const baseSlug = slugifyWorkspaceSegment(unitTitle)
  let candidate = `pages/${channelSlug}/${tabSlug}/${baseSlug}.md`
  let index = 2
  while (used.has(candidate)) {
    candidate = `pages/${channelSlug}/${tabSlug}/${baseSlug}-${index}.md`
    index += 1
  }
  return candidate
}

export function createWorkspaceUnit(
  channelSlug: string,
  tabSlug: string,
  title = 'Note',
  order = 0,
  usedPaths: Iterable<string> = []
): WorkspaceUnit {
  return {
    id: newUnitId(),
    title,
    order,
    filePath: allocateUnitPath(channelSlug, tabSlug, title, usedPaths)
  }
}

export function createWorkspaceTab(
  channelSlug: string,
  title = 'Untitled',
  order = 0,
  usedPaths: Iterable<string> = []
): WorkspaceTab {
  const slug = slugifyWorkspaceSegment(title)
  const unit = createWorkspaceUnit(channelSlug, slug, 'Note', 0, usedPaths)
  return {
    id: newTabId(),
    title,
    slug,
    order,
    units: [unit]
  }
}

export function createWorkspaceChannel(
  name = 'general',
  order = 0,
  usedPaths: Iterable<string> = []
): WorkspaceChannel {
  const slug = slugifyWorkspaceSegment(name)
  const tab = createWorkspaceTab(slug, 'Notes', 0, usedPaths)
  return {
    id: newChannelId(),
    name,
    slug,
    order,
    tabs: [tab]
  }
}

export function parseWorkspaceDocument(raw: unknown): WorkspaceDocument | null {
  if (!raw || typeof raw !== 'object') return null
  const doc = raw as WorkspaceDocument
  if (typeof doc.id !== 'string' || !Array.isArray(doc.channels)) return null
  for (const channel of doc.channels) {
    if (typeof channel.name !== 'string' || !Array.isArray(channel.tabs)) return null
  }
  return doc
}

export function createDefaultWorkspaceDoc(): WorkspaceDocument {
  const ts = new Date().toISOString()
  const channel = createWorkspaceChannel('general', 0)
  const tab = channel.tabs[0]!
  return {
    id: `ws_${Date.now().toString(36)}`,
    name: 'Notes',
    channels: [channel],
    ui: {
      activeChannelId: channel.id,
      activeTabIdByChannel: { [channel.id]: tab.id },
      channelsSidebarOpen: true
    },
    createdAt: ts,
    updatedAt: ts
  }
}

export function getActiveTab(
  doc: WorkspaceDocument,
  channelId: string
): WorkspaceTab | null {
  const channel = doc.channels.find((c) => c.id === channelId)
  if (!channel || channel.tabs.length === 0) return null
  const tabId = doc.ui.activeTabIdByChannel[channelId]
  return channel.tabs.find((t) => t.id === tabId) ?? channel.tabs[0] ?? null
}
