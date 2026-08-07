import { createStep } from '@mastra/core/workflows'
import { z } from 'zod'
import { flowPlanSchema } from '../../../../lib/flow-plan'
import { compilePlanPreview } from '../../../../lib/plan-compile'
import { configureControlNodesOutputSchema } from './configure-control-nodes-step'
import { structureOutputSchema } from './structure-step'

const buildCompleteSchema = z.object({
  status: z.literal('build_complete'),
  plan: flowPlanSchema,
  flowId: z.string(),
  flow: structureOutputSchema.shape.flow,
  entryNodeId: z.string(),
  nodeSources: z.record(z.string(), z.string()),
  codegenWarnings: z.array(z.string()).optional(),
  codegenFromAgent: z.record(z.string(), z.boolean()).optional()
})

export const assembleBuildStep = createStep({
  id: 'assemble-build-step',
  description: 'Merge per-node codegen results into the final build payload',
  inputSchema: configureControlNodesOutputSchema,
  outputSchema: buildCompleteSchema,
  execute: async ({ inputData, getStepResult }) => {
    const structure = getStepResult('structure-step') as z.infer<typeof structureOutputSchema>
    const { codegenResults, controlNodeData } = inputData
    const nodeSources: Record<string, string> = {}
    const codegenFromAgent: Record<string, boolean> = {}
    const codegenWarnings: string[] = []

    for (const item of codegenResults) {
      nodeSources[item.nodeId] = item.source
      codegenFromAgent[item.nodeId] = item.fromAgent
      if (item.warning) codegenWarnings.push(item.warning)
    }

    const flow = {
      ...structure.flow,
      nodes: structure.flow.nodes.map((node) => {
        if (node.type === 'control.if' && controlNodeData[node.id]) {
          return {
            ...node,
            data: {
              ...(node.data as Record<string, unknown>),
              ...controlNodeData[node.id]
            }
          }
        }

        if (node.type !== 'code.ts') return node
        const sourcePath = `nodes/${node.id}.ts`
        const data = { ...(node.data as Record<string, unknown>) }
        delete data.source
        return {
          ...node,
          data: {
            ...data,
            sourcePath,
            entry: 'main'
          }
        }
      })
    }

    const plan = {
      ...structure.plan,
      compiledPreview:
        structure.plan.compiledPreview ?? compilePlanPreview(structure.plan)
    }

    return {
      status: 'build_complete' as const,
      plan,
      flowId: structure.flowId,
      flow,
      entryNodeId: structure.entryNodeId,
      nodeSources,
      codegenWarnings: codegenWarnings.length > 0 ? codegenWarnings : undefined,
      codegenFromAgent
    }
  }
})

export { buildCompleteSchema }
