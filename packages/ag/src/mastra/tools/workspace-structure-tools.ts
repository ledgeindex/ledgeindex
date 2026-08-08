import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import {
  createChannel,
  createNote,
  createTab,
  getWorkspaceStructure,
  renameChannel,
  renameNote,
  renameTab,
  setActiveSelection
} from '../../lib/workspace/mutations'

export const workspaceGetStructureTool = createTool({
  id: 'workspace_get_structure',
  description:
    'List all knowledge items, tabs, and notes in the brain workspace with ids, titles, and markdown file paths.',
  inputSchema: z.object({}),
  outputSchema: z.object({
    ok: z.boolean(),
    structure: z.record(z.string(), z.unknown())
  }),
  execute: async (_input, context) => {
    const structure = getWorkspaceStructure(context?.requestContext)
    return { ok: true, structure: structure as Record<string, unknown> }
  }
})

export const workspaceCreateChannelTool = createTool({
  id: 'workspace_create_channel',
  description: 'Create a new knowledge item in the brain workspace.',
  inputSchema: z.object({
    name: z.string().min(1).max(80).describe('Knowledge item name, e.g. research')
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    channelId: z.string(),
    channelName: z.string(),
    message: z.string()
  }),
  execute: async ({ name }, context) => {
    const { channel } = createChannel(name, context?.requestContext)
    return {
      ok: true,
      channelId: channel.id,
      channelName: channel.name,
      message: `Created knowledge "${channel.name}"`
    }
  }
})

export const workspaceCreateTabTool = createTool({
  id: 'workspace_create_tab',
  description: 'Create a new tab in a knowledge item. Uses active knowledge when channelIdOrName is omitted.',
  inputSchema: z.object({
    title: z.string().min(1).max(80),
    channelIdOrName: z.string().optional()
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    tabId: z.string(),
    tabTitle: z.string(),
    channelName: z.string(),
    message: z.string()
  }),
  execute: async ({ title, channelIdOrName }, context) => {
    const { tab, channel } = createTab(title, channelIdOrName, context?.requestContext)
    return {
      ok: true,
      tabId: tab.id,
      tabTitle: tab.title,
      channelName: channel.name,
      message: `Created tab "${tab.title}" in knowledge "${channel.name}"`
    }
  }
})

export const workspaceCreateNoteTool = createTool({
  id: 'workspace_create_note',
  description:
    'Create a new markdown note in a tab. Uses active knowledge/tab when omitted. Optional initial markdown content.',
  inputSchema: z.object({
    title: z.string().min(1).max(120),
    channelIdOrName: z.string().optional(),
    tabIdOrTitle: z.string().optional(),
    initialContent: z.string().optional()
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    noteId: z.string(),
    title: z.string(),
    filePath: z.string(),
    message: z.string()
  }),
  execute: async ({ title, channelIdOrName, tabIdOrTitle, initialContent }, context) => {
    const { unit, filePath } = createNote(
      title,
      { channelIdOrName, tabIdOrTitle, initialContent },
      context?.requestContext
    )
    return {
      ok: true,
      noteId: unit.id,
      title: unit.title,
      filePath,
      message: `Created note "${unit.title}" at ${filePath}`
    }
  }
})

export const workspaceRenameChannelTool = createTool({
  id: 'workspace_rename_channel',
  description: 'Rename a knowledge item by id or name.',
  inputSchema: z.object({
    channelIdOrName: z.string(),
    name: z.string().min(1).max(80)
  }),
  outputSchema: z.object({ ok: z.boolean(), message: z.string() }),
  execute: async ({ channelIdOrName, name }, context) => {
    renameChannel(channelIdOrName, name, context?.requestContext)
    return { ok: true, message: `Renamed knowledge to "${name}"` }
  }
})

export const workspaceRenameTabTool = createTool({
  id: 'workspace_rename_tab',
  description: 'Rename a tab in a knowledge item.',
  inputSchema: z.object({
    channelIdOrName: z.string(),
    tabIdOrTitle: z.string(),
    title: z.string().min(1).max(80)
  }),
  outputSchema: z.object({ ok: z.boolean(), message: z.string() }),
  execute: async ({ channelIdOrName, tabIdOrTitle, title }, context) => {
    renameTab(channelIdOrName, tabIdOrTitle, title, context?.requestContext)
    return { ok: true, message: `Renamed tab to "${title}"` }
  }
})

export const workspaceRenameNoteTool = createTool({
  id: 'workspace_rename_note',
  description: 'Rename a note title in the workspace manifest (file path unchanged).',
  inputSchema: z.object({
    noteIdOrTitle: z.string(),
    title: z.string().min(1).max(120),
    channelIdOrName: z.string().optional(),
    tabIdOrTitle: z.string().optional()
  }),
  outputSchema: z.object({ ok: z.boolean(), message: z.string() }),
  execute: async ({ noteIdOrTitle, title, channelIdOrName, tabIdOrTitle }, context) => {
    renameNote(
      noteIdOrTitle,
      title,
      { channelIdOrName, tabIdOrTitle },
      context?.requestContext
    )
    return { ok: true, message: `Renamed note to "${title}"` }
  }
})

export const workspaceSetActiveTool = createTool({
  id: 'workspace_set_active',
  description: 'Set the active knowledge item and optional tab in the workspace UI.',
  inputSchema: z.object({
    channelIdOrName: z.string(),
    tabIdOrTitle: z.string().optional()
  }),
  outputSchema: z.object({ ok: z.boolean(), message: z.string() }),
  execute: async ({ channelIdOrName, tabIdOrTitle }, context) => {
    setActiveSelection(channelIdOrName, tabIdOrTitle, context?.requestContext)
    return { ok: true, message: 'Updated active knowledge/tab selection' }
  }
})

export const workspaceStructureTools = {
  workspaceGetStructureTool,
  workspaceCreateChannelTool,
  workspaceCreateTabTool,
  workspaceCreateNoteTool,
  workspaceRenameChannelTool,
  workspaceRenameTabTool,
  workspaceRenameNoteTool,
  workspaceSetActiveTool
}
