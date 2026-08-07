import { existsSync, readFileSync } from 'fs'
import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import {
  customInfoTitles,
  emptyFlowCustomInfo,
  parseFlowCustomInfo,
  type FlowCustomInfoItem
} from '../../lib/flow-custom-info'
import { flowCustomInfoPath } from '../../lib/flow-package-paths'
import { compactCustomInfoOutputForModel } from '../../lib/flow-editor-model-output'

function flowIdFromContext(requestContext: unknown): string | null {
  const ctx = requestContext as { get?: (key: string) => unknown } | null
  const flowId = ctx?.get?.('flow_id')
  return typeof flowId === 'string' && flowId.trim() ? flowId.trim() : null
}

function readCustomInfo(flowId: string) {
  const path = flowCustomInfoPath(flowId)
  if (!existsSync(path)) return emptyFlowCustomInfo()
  try {
    return parseFlowCustomInfo(JSON.parse(readFileSync(path, 'utf8')))
  } catch {
    return emptyFlowCustomInfo()
  }
}

function matchItem(
  items: FlowCustomInfoItem[],
  input: { id?: string; title?: string }
): FlowCustomInfoItem | null {
  const id = input.id?.trim()
  if (id) {
    return items.find((item) => item.id === id) ?? null
  }
  const title = input.title?.trim().toLowerCase()
  if (!title) return null
  const exact = items.find((item) => item.title.toLowerCase() === title)
  if (exact) return exact
  const partial = items.filter((item) => item.title.toLowerCase().includes(title))
  return partial.length === 1 ? partial[0]! : null
}

/**
 * List titles or fetch the body of a user-authored custom info item for this flow.
 */
export const getFlowCustomInfoTool = createTool({
  id: 'get_flow_custom_info',
  description:
    'Read user-authored custom info for this flow (custom-info.json). Call with no id/title to list available titles. Pass title or id to retrieve the full pasted text. Use this when the user references custom knowledge, constraints, API notes, or process notes they added in the Index tab.',
  inputSchema: z.object({
    id: z.string().optional().describe('Exact custom info item id.'),
    title: z
      .string()
      .optional()
      .describe('Exact or unique partial title of the custom info item to retrieve.')
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    error: z.string().optional(),
    titles: z.array(z.string()).optional(),
    item: z
      .object({
        id: z.string(),
        title: z.string(),
        body: z.string(),
        updatedAt: z.string()
      })
      .optional(),
    matches: z
      .array(z.object({ id: z.string(), title: z.string() }))
      .optional()
      .describe('When title matched multiple items, list candidates instead of a body.')
  }),
  execute: async (input, context) => {
    const flowId = flowIdFromContext(context?.requestContext)
    if (!flowId) {
      return { ok: false, error: 'flow_id missing from requestContext — open a flow in Ask AI' }
    }

    const file = readCustomInfo(flowId)
    const titles = customInfoTitles(file)
    const wantsBody = Boolean(input.id?.trim() || input.title?.trim())

    if (!wantsBody) {
      return { ok: true, titles }
    }

    const id = input.id?.trim()
    const titleQuery = input.title?.trim().toLowerCase()
    if (titleQuery && !id) {
      const partial = file.items.filter((item) => item.title.toLowerCase().includes(titleQuery))
      if (partial.length > 1) {
        const exact = partial.find((item) => item.title.toLowerCase() === titleQuery)
        if (!exact) {
          return {
            ok: true,
            titles,
            matches: partial.map((item) => ({ id: item.id, title: item.title }))
          }
        }
      }
    }

    const item = matchItem(file.items, input)
    if (!item) {
      return {
        ok: false,
        error: 'No custom info item matched. Call again with no args to list titles.',
        titles
      }
    }

    return {
      ok: true,
      titles,
      item: {
        id: item.id,
        title: item.title,
        body: item.body,
        updatedAt: item.updatedAt
      }
    }
  },
  toModelOutput: (output) => compactCustomInfoOutputForModel(output)
})

export function formatCustomInfoCatalogForPrompt(flowId: string): string | null {
  const titles = customInfoTitles(readCustomInfo(flowId))
  if (titles.length === 0) return null
  return [
    'Custom info items (Index tab — titles only; call get_flow_custom_info with a title to read the full text):',
    ...titles.map((title) => `- ${title}`)
  ].join('\n')
}
