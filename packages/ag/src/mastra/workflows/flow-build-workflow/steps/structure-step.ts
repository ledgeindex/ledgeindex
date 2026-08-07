import { createStep } from '@mastra/core/workflows'
import { z } from 'zod'
import { flowPlanSchema } from '../../../../lib/flow-plan'
import { compilePlanToFlowDefinition } from '../../../../lib/plan-to-flow'
import { buildCodegenTasks } from '../../../../lib/node-codegen-templates'
import { nodeCodegenTaskSchema } from '../../../../lib/node-codegen-task-schema'

const flowNodeSchema = z.object({
  id: z.string(),
  type: z.string(),
  position: z.object({ x: z.number(), y: z.number() }),
  data: z.record(z.string(), z.unknown())
})

const flowEdgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  sourceHandle: z.string().nullable().optional(),
  targetHandle: z.string().nullable().optional()
})

const structureOutputSchema = z.object({
  plan: flowPlanSchema,
  flowId: z.string(),
  flow: z.object({
    id: z.string(),
    name: z.string(),
    version: z.literal(1),
    nodes: z.array(flowNodeSchema),
    edges: z.array(flowEdgeSchema),
    settings: z.record(z.string(), z.unknown()).optional(),
    createdAt: z.string(),
    updatedAt: z.string()
  }),
  codeNodeIds: z.array(z.string()),
  entryNodeId: z.string(),
  codegenTasks: z.array(nodeCodegenTaskSchema)
})

export const structureStep = createStep({
  id: 'structure-step',
  description: 'Compile approved plan into flow.json topology',
  inputSchema: z.object({
    plan: flowPlanSchema,
    confirmed: z.boolean(),
    acknowledgedRisks: z.array(z.string()).optional(),
    flowId: z.string()
  }),
  outputSchema: structureOutputSchema,
  execute: async ({ inputData }) => {
    const { flow, codeNodeIds, entryNodeId } = compilePlanToFlowDefinition(
      inputData.plan,
      inputData.flowId,
      { name: inputData.plan.title }
    )

    const codegenTasks = buildCodegenTasks(inputData.plan, codeNodeIds)

    return {
      plan: inputData.plan,
      flowId: inputData.flowId,
      flow,
      codeNodeIds,
      entryNodeId,
      codegenTasks
    }
  }
})

export { structureOutputSchema }
