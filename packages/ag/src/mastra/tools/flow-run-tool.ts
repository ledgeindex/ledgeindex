import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { runFlowViaBridge } from '../../lib/desktop-bridge'
import { compactRunFlowOutputForModel } from '../../lib/flow-editor-model-output'

function flowIdFromContext(requestContext: unknown): string | null {
  const ctx = requestContext as { get?: (key: string) => unknown } | null
  const flowId = ctx?.get?.('flow_id')
  return typeof flowId === 'string' && flowId.trim() ? flowId.trim() : null
}

const stepSchema = z.object({
  nodeId: z.string(),
  nodeType: z.string(),
  label: z.string(),
  status: z.string(),
  durationMs: z.number(),
  message: z.string().optional(),
  output: z.unknown().optional()
})

/**
 * Run the open flow end-to-end via the desktop bridge.
 * Always runs the full pipeline from the primary trigger — no partial / single-node runs.
 */
export const runFlowTool = createTool({
  id: 'run_flow',
  description:
    'Run the entire current flow on the desktop from its primary trigger (full pipeline). Returns status, error (if failed), and compact step summaries. Do not pass node ids — there is no partial run. On failure, read the error / failed step messages and fix the flow.',
  inputSchema: z.object({
    dryRun: z
      .boolean()
      .optional()
      .describe(
        'If true, run with verify:true trigger payload (lighter / capped). Default false = normal run.'
      )
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    runId: z.string().optional(),
    flowId: z.string().optional(),
    entryNodeId: z.string().optional(),
    status: z.enum(['success', 'failed']).optional(),
    durationMs: z.number().optional(),
    error: z.string().optional(),
    availableNodeIds: z.array(z.string()).optional(),
    filteredNodeIds: z.array(z.string()).optional(),
    missingNodeIds: z.array(z.string()).optional(),
    steps: z.array(stepSchema).optional()
  }),
  execute: async (input, context) => {
    const flowId = flowIdFromContext(context?.requestContext)
    if (!flowId) {
      return { ok: false, error: 'flow_id missing from requestContext — open a flow in Ask AI' }
    }

    return runFlowViaBridge({
      flowId,
      dryRun: Boolean(input.dryRun)
    })
  },
  toModelOutput: (output) => compactRunFlowOutputForModel(output)
})
