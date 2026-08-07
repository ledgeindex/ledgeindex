import { createStep } from '@mastra/core/workflows'
import { z } from 'zod'
import { evalNodeCodegen } from '../../../../lib/node-eval'
import {
  codegenNodeResultSchema,
  nodeCodegenTaskSchema
} from '../../../../lib/node-codegen-task-schema'
import type { FlowPlan } from '../../../../lib/flow-plan'
import { structureOutputSchema } from './structure-step'
import { nodeBuilderAgent, nodeCodegenAgent } from '../../../agents/node-builder'

export const codegenOneNodeStep = createStep({
  id: 'codegen-one-node-step',
  description: 'Generate, validate, and heal TypeScript for one code.ts node',
  inputSchema: nodeCodegenTaskSchema,
  outputSchema: codegenNodeResultSchema,
  execute: async ({ inputData, getStepResult, writer }) => {
    const structure = getStepResult('structure-step') as z.infer<typeof structureOutputSchema>
    const plan = structure.plan as FlowPlan

    const emit = async (event: Parameters<typeof writer.write>[0]): Promise<void> => {
      await writer?.write(event)
    }

    console.log(`[node-eval] Starting nodes/${inputData.nodeId}.ts — ${inputData.label}`)

    try {
      const result = await evalNodeCodegen({
        agent: nodeCodegenAgent,
        healAgent: nodeBuilderAgent,
        task: inputData,
        plan,
        flowId: structure.flowId,
        onProgress: async (event) => {
          await emit(event)
        }
      })

      console.log(
        `[node-eval] Done nodes/${inputData.nodeId}.ts (${result.fromAgent ? 'agent' : 'template'})`
      )

      return {
        nodeId: result.nodeId,
        source: result.source,
        fromAgent: result.fromAgent,
        warning: result.warning
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await emit({ type: 'node-eval-failed', nodeId: inputData.nodeId, message })
      throw error
    }
  }
})
