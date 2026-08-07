import { createStep } from '@mastra/core/workflows'
import { z } from 'zod'
import type { FlowPlan, PlanPhase } from '../../../../lib/flow-plan'
import { codegenNodeResultSchema } from '../../../../lib/node-codegen-task-schema'
import {
  configureControlIfFromBuild,
  upstreamSourcesForNode
} from '../../../../lib/configure-control-if'
import { phaseForNodeId } from '../../../../lib/plan-to-flow'
import { structureOutputSchema } from './structure-step'

export const configureControlNodesOutputSchema = z.object({
  codegenResults: z.array(codegenNodeResultSchema),
  controlNodeData: z.record(z.string(), z.record(z.string(), z.unknown()))
})

export const configureControlNodesStep = createStep({
  id: 'configure-control-nodes-step',
  description: 'Configure control.if nodes from upstream codegen output shape',
  inputSchema: z.array(codegenNodeResultSchema),
  outputSchema: configureControlNodesOutputSchema,
  execute: async ({ inputData, getStepResult, writer }) => {
    const structure = getStepResult('structure-step') as z.infer<typeof structureOutputSchema>
    const plan = structure.plan as FlowPlan
    const sources = new Map(inputData.map((item) => [item.nodeId, item.source]))
    const controlNodeData: Record<string, Record<string, unknown>> = {}

    for (const node of structure.flow.nodes) {
      if (node.type !== 'control.if') continue

      const upstreamIds = upstreamSourcesForNode(node.id, structure.flow.edges)
      const upstreamId = upstreamIds.find((id) => sources.has(id))
      if (!upstreamId) continue

      const upstreamSource = sources.get(upstreamId)
      if (!upstreamSource) continue

      const phase = phaseForNodeId(plan, node.id)
      if (!phase) continue

      const upstreamNode = structure.flow.nodes.find((item) => item.id === upstreamId)
      const upstreamLabel =
        typeof upstreamNode?.data?.label === 'string'
          ? upstreamNode.data.label
          : upstreamId

      await writer?.write({
        type: 'control-if-config-start',
        nodeId: node.id,
        upstreamNodeId: upstreamId
      })

      const configured = await configureControlIfFromBuild({
        ifPhase: phase as PlanPhase,
        label: typeof node.data?.label === 'string' ? node.data.label : phase.title,
        upstreamNodeId: upstreamId,
        upstreamLabel,
        upstreamSource
      })

      controlNodeData[node.id] = {
        ...configured,
        configPending: false
      }

      await writer?.write({
        type: 'control-if-config-done',
        nodeId: node.id,
        upstreamNodeId: upstreamId,
        field: configured.field,
        operator: configured.operator
      })
    }

    return {
      codegenResults: inputData,
      controlNodeData
    }
  }
})
