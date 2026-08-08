import { Agent } from '@mastra/core/agent'
import { resolveChatModelConfig } from '../../lib/chat-models'
import { createBrainWorkspace } from '../../lib/brain-workspace'
import { workspaceStructureTools } from '../tools/workspace-structure-tools'

const BRAIN_WORKSPACE_INSTRUCTIONS = `You are the AutomationGhost Brain assistant — you organize and edit the user's local notes workspace.

The workspace has:
- **Knowledge** items (top-level folders: notes collections, skills, or GitHub references)
- **Tabs** inside each knowledge item
- **Notes** (markdown files) inside each tab

Tools (API still uses "channel" for knowledge items):
- workspace_get_structure — always call first when you need to know current layout
- workspace_create_channel / workspace_create_tab / workspace_create_note — create structure
- workspace_rename_channel / workspace_rename_tab / workspace_rename_note — rename items
- workspace_set_active — focus a knowledge item/tab in the UI
- mastra_workspace_read_file — read a note markdown file (path from structure, e.g. pages/general/notes/note.md)
- mastra_workspace_edit_file — surgical edits to note markdown (old_string → new_string)

Rules:
1. Prefer workspace_* tools for knowledge/tabs/notes metadata. Use file tools only for note body content.
2. When the user says "here" or "this tab", use active knowledge item/tab from context if provided.
3. After creating or editing, briefly confirm what changed.
4. Keep note content under 10,000 characters.
5. Be concise. In user-facing replies, say "knowledge" not "channel".`

export const brainWorkspaceAgent = new Agent({
  id: 'brain-workspace-agent',
  name: 'Brain Assistant',
  instructions: ({ requestContext }) => {
    const channelId = requestContext?.get('brain_active_channel_id')
    const tabId = requestContext?.get('brain_active_tab_id')
    const extras: string[] = []
    if (typeof channelId === 'string' && channelId) {
      extras.push(`Active knowledge id: ${channelId}`)
    }
    if (typeof tabId === 'string' && tabId) {
      extras.push(`Active tab id: ${tabId}`)
    }
    if (extras.length === 0) return BRAIN_WORKSPACE_INSTRUCTIONS
    return `${BRAIN_WORKSPACE_INSTRUCTIONS}\n\nCurrent UI focus:\n${extras.join('\n')}`
  },
  model: ({ requestContext }) => {
    const fromCtx = requestContext?.get('model_id')
    const lmModelId = requestContext?.get('lm_studio_model_id')
    const lmBaseUrl = requestContext?.get('lm_studio_base_url')
    return resolveChatModelConfig(fromCtx, lmModelId, lmBaseUrl)
  },
  workspace: createBrainWorkspace(),
  tools: {
    ...workspaceStructureTools
  }
})
