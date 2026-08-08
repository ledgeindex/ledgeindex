import { z } from 'zod'
import type { FlowPlan } from './flow-plan'
import { assertStepOutputShape } from './assert-output-shape'

export const repairDiagnosisSchema = z.object({
  targets: z.array(z.string().min(1)).max(2),
  reason: z.string(),
  strategy: z.enum(['runtime_heal', 'agent_contract_heal', 'unrepairable']),
  unrepairable: z.boolean().optional(),
  suggestPlanRevision: z.boolean().optional()
})

export type RepairDiagnosis = z.infer<typeof repairDiagnosisSchema>

export type VerifyStepSnapshot = {
  nodeId: string
  nodeType: string
  label: string
  status: 'ok' | 'warning' | 'error' | 'skipped'
  output?: unknown
  message?: string
  inputSnapshot?: unknown
}

function phaseForNodeId(plan: FlowPlan, nodeId: string) {
  return plan.phases.find((p) => {
    const prefix = `phase-${p.phase}`
    return nodeId === prefix || nodeId.startsWith(`${prefix}-`)
  })
}

function looksLikeMissingFieldError(message: string): boolean {
  return /undefined|cannot read|is not a function|missing|outputShape|expected key/i.test(message)
}

function looksLikeAgentSchemaError(message: string): boolean {
  return /structured output|outputSchema|agentOutputSchema|schema validation|invalid_type|ZodError|JSON Schema|envelope key|expected object|matches/i.test(
    message
  )
}

function isCodeNode(nodeType: string): boolean {
  return nodeType === 'code.ts' || nodeType.startsWith('code')
}

function isAgentNode(nodeType: string): boolean {
  return nodeType === 'agent' || nodeType.startsWith('agent')
}

/**
 * Deterministic cascade-first diagnosis: code → runtime_heal, agent → agent_contract_heal.
 */
export function diagnoseVerifyFailure(input: {
  plan: FlowPlan
  steps: VerifyStepSnapshot[]
  shapeFailures?: Array<{ nodeId: string; message: string }>
}): RepairDiagnosis {
  const shapeFailures = input.shapeFailures ?? []
  if (shapeFailures.length > 0) {
    const first = shapeFailures[0]!
    const step = input.steps.find((s) => s.nodeId === first.nodeId)
    if (step && isAgentNode(step.nodeType)) {
      return {
        targets: [first.nodeId],
        reason: `Agent contract / shape failed on ${first.nodeId}: ${first.message}`,
        strategy: 'agent_contract_heal'
      }
    }
    if (step && !isCodeNode(step.nodeType)) {
      return {
        targets: [],
        reason: `Shape assert failed on ${first.nodeId} (${step.nodeType}): ${first.message}`,
        strategy: 'unrepairable',
        unrepairable: true,
        suggestPlanRevision: true
      }
    }
    return {
      targets: [first.nodeId],
      reason: `Shape assert failed on ${first.nodeId}: ${first.message}`,
      strategy: 'runtime_heal'
    }
  }

  const failed = input.steps.find((s) => s.status === 'error')
  if (!failed) {
    return {
      targets: [],
      reason: 'No failed steps',
      strategy: 'unrepairable',
      unrepairable: true
    }
  }

  const idx = input.steps.findIndex((s) => s.nodeId === failed.nodeId)
  const message = failed.message ?? 'Step failed'

  if (isAgentNode(failed.nodeType)) {
    return {
      targets: [failed.nodeId],
      reason: looksLikeAgentSchemaError(message)
        ? `Agent schema/runtime failed on ${failed.nodeId}: ${message}`
        : `Agent node ${failed.nodeId} failed: ${message}`,
      strategy: 'agent_contract_heal'
    }
  }

  if (looksLikeMissingFieldError(message) && idx > 0) {
    for (let i = idx - 1; i >= 0; i -= 1) {
      const prev = input.steps[i]!
      if (prev.status === 'ok' && isCodeNode(prev.nodeType)) {
        return {
          targets: [prev.nodeId],
          reason: `Cascade: ${failed.nodeId} failed (${message}) — repairing upstream ${prev.nodeId}`,
          strategy: 'runtime_heal'
        }
      }
      if (prev.status === 'ok' && isAgentNode(prev.nodeType)) {
        return {
          targets: [prev.nodeId],
          reason: `Cascade: ${failed.nodeId} failed (${message}) — repairing upstream agent ${prev.nodeId}`,
          strategy: 'agent_contract_heal'
        }
      }
    }
  }

  if (!isCodeNode(failed.nodeType)) {
    return {
      targets: [],
      reason: `Non-code node ${failed.nodeId} failed: ${message}`,
      strategy: 'unrepairable',
      unrepairable: true,
      suggestPlanRevision: true
    }
  }

  const phase = phaseForNodeId(input.plan, failed.nodeId)
  return {
    targets: [failed.nodeId],
    reason: phase
      ? `Runtime error on ${failed.nodeId} (${phase.title}): ${message}`
      : `Runtime error on ${failed.nodeId}: ${message}`,
    strategy: 'runtime_heal'
  }
}

export function collectShapeFailures(
  plan: FlowPlan,
  steps: VerifyStepSnapshot[]
): Array<{ nodeId: string; message: string }> {
  const failures: Array<{ nodeId: string; message: string }> = []
  for (const step of steps) {
    if (step.status !== 'ok') continue
    const phase = phaseForNodeId(plan, step.nodeId)
    if (!phase?.outputShape) continue
    const result = assertStepOutputShape(step.output, phase.outputShape)
    if (!result.ok) {
      failures.push({ nodeId: step.nodeId, message: result.message })
    }
  }
  return failures
}

export function phasePlanForNode(plan: FlowPlan, nodeId: string): string | undefined {
  return phaseForNodeId(plan, nodeId)?.plan
}

export function outputShapeForNode(plan: FlowPlan, nodeId: string): string | undefined {
  return phaseForNodeId(plan, nodeId)?.outputShape
}
