import { createWorkflow, createStep } from '@mastra/core/workflows'
import { z } from 'zod'
import {
  diagnoseVerifyFailure,
  collectShapeFailures,
  repairDiagnosisSchema
} from '../../../lib/verify-diagnose'
import { evalNodeRuntimeHeal } from '../../../lib/eval-node-runtime-heal'
import { evalAgentContractHeal } from '../../../lib/eval-agent-contract-heal'
import { flowRepairAgent } from '../../agents/flow-repair-agent'
import { flowAgentContractRepairAgent } from '../../agents/flow-agent-contract-repair-agent'
import type { FlowPlan } from '../../../lib/flow-plan'

/**
 * Mastra-side verify repair: diagnose + heal given a dry-run snapshot from Electron.
 * Electron still owns dry-run / isolated re-run (npm + child process).
 */
const stepSnapshotSchema = z.object({
  nodeId: z.string(),
  nodeType: z.string(),
  label: z.string(),
  status: z.enum(['ok', 'warning', 'error', 'skipped']),
  output: z.unknown().optional(),
  message: z.string().optional(),
  inputSnapshot: z.unknown().optional()
})

const verifyRepairInputSchema = z.object({
  flowId: z.string().min(1),
  plan: z.unknown(),
  steps: z.array(stepSnapshotSchema),
  userHint: z.string().optional(),
  priorRepairSummaries: z.array(z.string()).optional(),
  attempt: z.number().int().positive().default(1)
})

const diagnoseOutputSchema = z.object({
  flowId: z.string(),
  plan: z.unknown(),
  steps: z.array(stepSnapshotSchema),
  userHint: z.string().optional(),
  priorRepairSummaries: z.array(z.string()).optional(),
  attempt: z.number(),
  diagnosis: repairDiagnosisSchema,
  shapeFailures: z.array(z.object({ nodeId: z.string(), message: z.string() }))
})

const healOutputSchema = z.object({
  diagnosis: repairDiagnosisSchema,
  shapeFailures: z.array(z.object({ nodeId: z.string(), message: z.string() })),
  repairs: z.array(
    z.object({
      nodeId: z.string(),
      summary: z.string(),
      ok: z.boolean(),
      error: z.string().optional()
    })
  )
})

const diagnoseStep = createStep({
  id: 'diagnose-verify-failure',
  inputSchema: verifyRepairInputSchema,
  outputSchema: diagnoseOutputSchema,
  execute: async ({ inputData }) => {
    const plan = inputData.plan as FlowPlan
    const shapeFailures = collectShapeFailures(plan, inputData.steps)
    const diagnosis = diagnoseVerifyFailure({
      plan,
      steps: inputData.steps,
      shapeFailures
    })
    return {
      ...inputData,
      diagnosis,
      shapeFailures
    }
  }
})

const healStep = createStep({
  id: 'heal-verify-targets',
  inputSchema: diagnoseOutputSchema,
  outputSchema: healOutputSchema,
  execute: async ({ inputData }) => {
    const { diagnosis, flowId, plan, steps, userHint, priorRepairSummaries, attempt } = inputData
    const typedPlan = plan as FlowPlan

    if (
      (diagnosis.strategy !== 'runtime_heal' &&
        diagnosis.strategy !== 'agent_contract_heal') ||
      diagnosis.targets.length === 0
    ) {
      return {
        diagnosis,
        shapeFailures: inputData.shapeFailures,
        repairs: []
      }
    }

    const repairs: Array<{ nodeId: string; summary: string; ok: boolean; error?: string }> = []

    for (const nodeId of diagnosis.targets.slice(0, 2)) {
      const step = steps.find((s) => s.nodeId === nodeId)
      const shapeFail = inputData.shapeFailures.find((f) => f.nodeId === nodeId)
      const runtimeError = shapeFail?.message ?? step?.message ?? diagnosis.reason

      const phase = typedPlan.phases.find((p) => {
        const prefix = `phase-${p.phase}`
        return nodeId === prefix || nodeId.startsWith(`${prefix}-`)
      })

      try {
        if (diagnosis.strategy === 'agent_contract_heal') {
          const result = await evalAgentContractHeal(flowAgentContractRepairAgent, {
            flowId,
            nodeId,
            runtimeError,
            agentMode: phase?.agentMode,
            agentInstructions: phase?.agentInstructions,
            agentOutputSchema: phase?.agentOutputSchema as Record<string, unknown> | undefined,
            outputShape: phase?.outputShape,
            phasePlan: phase?.plan,
            inputSnapshot: step?.inputSnapshot,
            observedOutput: step?.output,
            userHint,
            attempt,
            priorRepairSummaries
          })
          repairs.push({
            nodeId,
            summary: `${result.summary} [${result.agentMode}]`,
            ok: true
          })
          continue
        }

        const result = await evalNodeRuntimeHeal(flowRepairAgent, {
          flowId,
          nodeId,
          runtimeError,
          inputSnapshot: step?.inputSnapshot,
          observedOutput: step?.output,
          outputShape: phase?.outputShape,
          phasePlan: phase?.plan,
          userHint,
          attempt,
          priorRepairSummaries
        })
        repairs.push({ nodeId, summary: result.summary, ok: true })
      } catch (error) {
        repairs.push({
          nodeId,
          summary: '',
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        })
      }
    }

    return {
      diagnosis,
      shapeFailures: inputData.shapeFailures,
      repairs
    }
  }
})

export const flowVerifyRepairWorkflow = createWorkflow({
  id: 'flow-verify-repair-workflow',
  inputSchema: verifyRepairInputSchema,
  outputSchema: healOutputSchema
})
  .then(diagnoseStep)
  .then(healStep)

flowVerifyRepairWorkflow.commit()
