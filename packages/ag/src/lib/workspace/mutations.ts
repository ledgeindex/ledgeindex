import type { RequestContext } from '@mastra/core/request-context'
import {
  collectWorkspaceFilePaths,
  createWorkspaceChannel,
  createWorkspaceTab,
  createWorkspaceUnit,
  getActiveTab,
  sortChannels,
  sortTabs,
  sortUnits,
  type WorkspaceChannel,
  type WorkspaceDocument,
  type WorkspaceTab,
  type WorkspaceUnit
} from './schema'
import {
  readWorkspaceDocument,
  resolveWorkspaceRoot,
  saveWorkspaceDocument,
  writeWorkspacePage
} from './io'

export type WorkspaceContext = {
  activeChannelId?: string | null
  activeTabId?: string | null
}

export function readWorkspaceContext(requestContext?: RequestContext): WorkspaceContext {
  return {
    activeChannelId:
      typeof requestContext?.get('brain_active_channel_id') === 'string'
        ? String(requestContext.get('brain_active_channel_id'))
        : null,
    activeTabId:
      typeof requestContext?.get('brain_active_tab_id') === 'string'
        ? String(requestContext.get('brain_active_tab_id'))
        : null
  }
}

function findChannel(doc: WorkspaceDocument, channelIdOrName?: string | null): WorkspaceChannel | null {
  if (!channelIdOrName?.trim()) return null
  const key = channelIdOrName.trim().toLowerCase()
  return (
    doc.channels.find((c) => c.id === channelIdOrName) ??
    doc.channels.find((c) => c.name.toLowerCase() === key) ??
    doc.channels.find((c) => c.slug === key) ??
    null
  )
}

function findTab(channel: WorkspaceChannel, tabIdOrTitle?: string | null): WorkspaceTab | null {
  if (!tabIdOrTitle?.trim()) return null
  const key = tabIdOrTitle.trim().toLowerCase()
  return (
    channel.tabs.find((t) => t.id === tabIdOrTitle) ??
    channel.tabs.find((t) => t.title.toLowerCase() === key) ??
    channel.tabs.find((t) => t.slug === key) ??
    null
  )
}

function findUnit(tab: WorkspaceTab, unitIdOrTitle?: string | null): WorkspaceUnit | null {
  if (!unitIdOrTitle?.trim()) return null
  const key = unitIdOrTitle.trim().toLowerCase()
  return (
    tab.units.find((u) => u.id === unitIdOrTitle) ??
    tab.units.find((u) => u.title.toLowerCase() === key) ??
    null
  )
}

function resolveChannel(
  doc: WorkspaceDocument,
  ctx: WorkspaceContext,
  channelIdOrName?: string | null
): WorkspaceChannel {
  const found = findChannel(doc, channelIdOrName)
  if (found) return found
  if (ctx.activeChannelId) {
    const active = findChannel(doc, ctx.activeChannelId)
    if (active) return active
  }
  const first = sortChannels(doc.channels)[0]
  if (!first) throw new Error('Workspace has no channels')
  return first
}

function resolveTab(
  doc: WorkspaceDocument,
  channel: WorkspaceChannel,
  ctx: WorkspaceContext,
  tabIdOrTitle?: string | null
): WorkspaceTab {
  const found = findTab(channel, tabIdOrTitle)
  if (found) return found
  if (ctx.activeTabId) {
    const active = findTab(channel, ctx.activeTabId)
    if (active) return active
  }
  const active = getActiveTab(doc, channel.id)
  if (active) return active
  const first = sortTabs(channel.tabs)[0]
  if (!first) throw new Error(`Channel "${channel.name}" has no tabs`)
  return first
}

function withSaved(
  root: string,
  prev: WorkspaceDocument,
  updater: (doc: WorkspaceDocument) => WorkspaceDocument
): WorkspaceDocument {
  const next = updater(prev)
  return saveWorkspaceDocument(root, next, prev)
}

export function workspaceStructureSummary(doc: WorkspaceDocument): object {
  return {
    activeChannelId: doc.ui.activeChannelId,
    activeTabIdByChannel: doc.ui.activeTabIdByChannel,
    channels: sortChannels(doc.channels).map((channel) => ({
      id: channel.id,
      name: channel.name,
      slug: channel.slug,
      tabs: sortTabs(channel.tabs).map((tab) => ({
        id: tab.id,
        title: tab.title,
        slug: tab.slug,
        notes: sortUnits(tab.units).map((unit) => ({
          id: unit.id,
          title: unit.title,
          filePath: unit.filePath
        }))
      }))
    }))
  }
}

export function getWorkspaceStructure(requestContext?: RequestContext): object {
  const root = resolveWorkspaceRoot(
    typeof requestContext?.get('brain_workspace_root') === 'string'
      ? String(requestContext.get('brain_workspace_root'))
      : null
  )
  const doc = readWorkspaceDocument(root)
  return workspaceStructureSummary(doc)
}

export function createChannel(
  name: string,
  requestContext?: RequestContext
): { channel: WorkspaceChannel; doc: WorkspaceDocument } {
  const root = resolveWorkspaceRoot(
    typeof requestContext?.get('brain_workspace_root') === 'string'
      ? String(requestContext.get('brain_workspace_root'))
      : null
  )
  const prev = readWorkspaceDocument(root)
  const usedPaths = collectWorkspaceFilePaths(prev)
  const order = prev.channels.length
  const channel = createWorkspaceChannel(name, order, usedPaths)
  const doc = withSaved(root, prev, (d) => ({
    ...d,
    channels: [...d.channels, channel],
    ui: {
      ...d.ui,
      activeChannelId: channel.id,
      activeTabIdByChannel: {
        ...d.ui.activeTabIdByChannel,
        [channel.id]: channel.tabs[0]!.id
      }
    }
  }))
  return { channel, doc }
}

export function createTab(
  title: string,
  channelIdOrName: string | undefined,
  requestContext?: RequestContext
): { tab: WorkspaceTab; channel: WorkspaceChannel; doc: WorkspaceDocument } {
  const root = resolveWorkspaceRoot(
    typeof requestContext?.get('brain_workspace_root') === 'string'
      ? String(requestContext.get('brain_workspace_root'))
      : null
  )
  const ctx = readWorkspaceContext(requestContext)
  const prev = readWorkspaceDocument(root)
  const channel = resolveChannel(prev, ctx, channelIdOrName)
  const usedPaths = collectWorkspaceFilePaths(prev)
  const tab = createWorkspaceTab(channel.slug, title, channel.tabs.length, usedPaths)
  const doc = withSaved(root, prev, (d) => ({
    ...d,
    channels: d.channels.map((ch) =>
      ch.id === channel.id ? { ...ch, tabs: [...ch.tabs, tab] } : ch
    ),
    ui: {
      ...d.ui,
      activeChannelId: channel.id,
      activeTabIdByChannel: {
        ...d.ui.activeTabIdByChannel,
        [channel.id]: tab.id
      }
    }
  }))
  return { tab, channel, doc }
}

export function createNote(
  title: string,
  options: {
    channelIdOrName?: string
    tabIdOrTitle?: string
    initialContent?: string
  },
  requestContext?: RequestContext
): { unit: WorkspaceUnit; filePath: string; doc: WorkspaceDocument } {
  const root = resolveWorkspaceRoot(
    typeof requestContext?.get('brain_workspace_root') === 'string'
      ? String(requestContext.get('brain_workspace_root'))
      : null
  )
  const ctx = readWorkspaceContext(requestContext)
  const prev = readWorkspaceDocument(root)
  const channel = resolveChannel(prev, ctx, options.channelIdOrName)
  const tab = resolveTab(prev, channel, ctx, options.tabIdOrTitle)
  const usedPaths = collectWorkspaceFilePaths(prev)
  const unit = createWorkspaceUnit(channel.slug, tab.slug, title, tab.units.length, usedPaths)
  const doc = withSaved(root, prev, (d) => ({
    ...d,
    channels: d.channels.map((ch) =>
      ch.id !== channel.id
        ? ch
        : {
            ...ch,
            tabs: ch.tabs.map((t) =>
              t.id !== tab.id ? t : { ...t, units: [...t.units, unit] }
            )
          }
    ),
    ui: {
      ...d.ui,
      activeChannelId: channel.id,
      activeTabIdByChannel: { ...d.ui.activeTabIdByChannel, [channel.id]: tab.id }
    }
  }))
  if (options.initialContent?.trim()) {
    writeWorkspacePage(root, unit.filePath, options.initialContent)
  }
  return { unit, filePath: unit.filePath, doc }
}

export function renameChannel(
  channelIdOrName: string,
  name: string,
  requestContext?: RequestContext
): WorkspaceDocument {
  const root = resolveWorkspaceRoot(
    typeof requestContext?.get('brain_workspace_root') === 'string'
      ? String(requestContext.get('brain_workspace_root'))
      : null
  )
  const prev = readWorkspaceDocument(root)
  const channel = findChannel(prev, channelIdOrName)
  if (!channel) throw new Error(`Channel not found: ${channelIdOrName}`)
  return withSaved(root, prev, (d) => ({
    ...d,
    channels: d.channels.map((ch) => (ch.id === channel.id ? { ...ch, name } : ch))
  }))
}

export function renameTab(
  channelIdOrName: string,
  tabIdOrTitle: string,
  title: string,
  requestContext?: RequestContext
): WorkspaceDocument {
  const root = resolveWorkspaceRoot(
    typeof requestContext?.get('brain_workspace_root') === 'string'
      ? String(requestContext.get('brain_workspace_root'))
      : null
  )
  const prev = readWorkspaceDocument(root)
  const channel = findChannel(prev, channelIdOrName)
  if (!channel) throw new Error(`Channel not found: ${channelIdOrName}`)
  const tab = findTab(channel, tabIdOrTitle)
  if (!tab) throw new Error(`Tab not found: ${tabIdOrTitle}`)
  return withSaved(root, prev, (d) => ({
    ...d,
    channels: d.channels.map((ch) =>
      ch.id !== channel.id
        ? ch
        : {
            ...ch,
            tabs: ch.tabs.map((t) => (t.id === tab.id ? { ...t, title } : t))
          }
    )
  }))
}

export function renameNote(
  unitIdOrTitle: string,
  title: string,
  options: { channelIdOrName?: string; tabIdOrTitle?: string },
  requestContext?: RequestContext
): WorkspaceDocument {
  const root = resolveWorkspaceRoot(
    typeof requestContext?.get('brain_workspace_root') === 'string'
      ? String(requestContext.get('brain_workspace_root'))
      : null
  )
  const ctx = readWorkspaceContext(requestContext)
  const prev = readWorkspaceDocument(root)
  const channel = resolveChannel(prev, ctx, options.channelIdOrName)
  const tab = resolveTab(prev, channel, ctx, options.tabIdOrTitle)
  const unit = findUnit(tab, unitIdOrTitle)
  if (!unit) throw new Error(`Note not found: ${unitIdOrTitle}`)
  return withSaved(root, prev, (d) => ({
    ...d,
    channels: d.channels.map((ch) =>
      ch.id !== channel.id
        ? ch
        : {
            ...ch,
            tabs: ch.tabs.map((t) =>
              t.id !== tab.id
                ? t
                : {
                    ...t,
                    units: t.units.map((u) => (u.id === unit.id ? { ...u, title } : u))
                  }
            )
          }
    )
  }))
}

export function setActiveSelection(
  channelIdOrName: string,
  tabIdOrTitle: string | undefined,
  requestContext?: RequestContext
): WorkspaceDocument {
  const root = resolveWorkspaceRoot(
    typeof requestContext?.get('brain_workspace_root') === 'string'
      ? String(requestContext.get('brain_workspace_root'))
      : null
  )
  const prev = readWorkspaceDocument(root)
  const ctx = readWorkspaceContext(requestContext)
  const channel = resolveChannel(prev, ctx, channelIdOrName)
  const tab = tabIdOrTitle ? resolveTab(prev, channel, ctx, tabIdOrTitle) : getActiveTab(prev, channel.id)
  if (!tab) throw new Error(`Tab not found for channel ${channel.name}`)
  return withSaved(root, prev, (d) => ({
    ...d,
    ui: {
      ...d.ui,
      activeChannelId: channel.id,
      activeTabIdByChannel: { ...d.ui.activeTabIdByChannel, [channel.id]: tab.id }
    }
  }))
}
