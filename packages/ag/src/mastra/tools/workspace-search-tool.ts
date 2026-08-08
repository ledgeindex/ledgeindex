import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { searchWorkspaceViaLedgeIndex } from '../../lib/desktop-bridge'

const workspaceSearchHitSchema = z.object({
  filePath: z.string(),
  label: z.string(),
  chunkIndex: z.number().int().nonnegative(),
  text: z.string(),
  score: z.number()
})

export const workspaceSearchTool = createTool({
  id: 'workspace_search',
  description:
    'Semantic search across local Brain workspace notes (knowledge, tabs, markdown notes). Use when the user asks about their saved notes, project context, or documentation they wrote in Brain — not for live web facts.',
  inputSchema: z.object({
    query: z
      .string()
      .min(2)
      .describe('Natural-language search query'),
    topK: z
      .number()
      .int()
      .min(1)
      .max(20)
      .optional()
      .default(8)
      .describe('Number of relevant chunks to return (default 8)')
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    query: z.string(),
    results: z.array(workspaceSearchHitSchema),
    error: z.string().optional()
  }),
  execute: async ({ query, topK }) => {
    const k = topK ?? 8
    return searchWorkspaceViaLedgeIndex(query, k)
  }
})
