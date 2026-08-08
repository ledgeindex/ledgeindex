import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import {
  fetchEngineCatalog,
  saveStoredAgent,
  parseDefaultModel
} from '../../lib/stored-agent-api'

export const listCapabilityCatalogTool = createTool({
  id: 'list-capability-catalog',
  description:
    'List registered tools, code-defined agents, and workflows available for a new stored agent.',
  inputSchema: z.object({
    includeDescriptions: z
      .boolean()
      .optional()
      .describe('Include short descriptions (default true)')
  }),
  outputSchema: z.object({
    tools: z.array(z.object({ id: z.string(), description: z.string().optional() })),
    agents: z.array(
      z.object({ id: z.string(), name: z.string(), description: z.string().optional() })
    ),
    workflows: z.array(
      z.object({ id: z.string(), name: z.string(), description: z.string().optional() })
    )
  }),
  execute: async (inputData) => {
    const catalog = await fetchEngineCatalog()
    if (inputData.includeDescriptions === false) {
      return {
        tools: catalog.tools.map(({ id }) => ({ id })),
        agents: catalog.agents.map(({ id, name }) => ({ id, name })),
        workflows: catalog.workflows.map(({ id, name }) => ({ id, name }))
      }
    }
    return catalog
  }
})

export const saveStoredAgentTool = createTool({
  id: 'save-stored-agent',
  description:
    'Persist a stored agent to AutomationGhost (Mastra stored agents API). Call once the draft is complete.',
  inputSchema: z.object({
    id: z
      .string()
      .describe('Stable kebab-case id, e.g. blog-tweet-drafter'),
    name: z.string().describe('Human-readable agent name'),
    description: z.string().optional(),
    instructions: z.string().describe('Full system prompt / operating instructions'),
    toolIds: z.array(z.string()).optional().describe('Tool ids from list-capability-catalog'),
    agentIds: z
      .array(z.string())
      .optional()
      .describe('Sub-agent ids from list-capability-catalog'),
    workflowIds: z.array(z.string()).optional(),
    modelProvider: z.string().optional(),
    modelName: z.string().optional(),
    skillIds: z
      .array(z.string())
      .optional()
      .describe('User library skill ids — stored in metadata for desktop injection')
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    agentId: z.string().optional(),
    error: z.string().optional(),
    warnings: z.array(z.string()).optional()
  }),
  execute: async (inputData) => {
    const defaults = parseDefaultModel()
    const metadata =
      inputData.skillIds && inputData.skillIds.length > 0
        ? { skillIds: inputData.skillIds }
        : undefined

    return saveStoredAgent({
      id: inputData.id,
      name: inputData.name,
      description: inputData.description,
      instructions: inputData.instructions,
      toolIds: inputData.toolIds,
      agentIds: inputData.agentIds,
      workflowIds: inputData.workflowIds,
      model: {
        provider: inputData.modelProvider ?? defaults.provider,
        name: inputData.modelName ?? defaults.name
      },
      metadata
    })
  }
})

export const agentAssemblerTools = {
  listCapabilityCatalogTool,
  saveStoredAgentTool
}
