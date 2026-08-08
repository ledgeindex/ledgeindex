import { registerApiRoute } from '@mastra/core/server'
import { z } from 'zod'
import { evalNodeRuntimeHeal } from '../lib/eval-node-runtime-heal'
import { evalAgentContractHeal } from '../lib/eval-agent-contract-heal'
import { evalVerifyAnalyze } from '../lib/eval-verify-analyze'
import { evalFlowPackageHeal } from '../lib/eval-flow-package-heal'
import { diagnoseVerifyFailure, collectShapeFailures } from '../lib/verify-diagnose'
import { flowRepairAgent } from '../mastra/agents/flow-repair-agent'
import { flowAgentContractRepairAgent } from '../mastra/agents/flow-agent-contract-repair-agent'
import { flowVerifyAnalyzeAgent } from '../mastra/agents/flow-verify-analyze-agent'
import { flowPackageHealAgent } from '../mastra/agents/flow-package-heal-agent'
import type { FlowPlan } from '../lib/flow-plan'

const healBodySchema = z.object({
  flowId: z.string().min(1),
  nodeId: z.string().min(1),
  runtimeError: z.string().min(1),
  inputSnapshot: z.unknown().optional(),
  observedOutput: z.unknown().optional(),
  outputShape: z.string().optional(),
  phasePlan: z.string().optional(),
  userHint: z.string().optional(),
  attempt: z.number().int().positive().default(1),
  priorRepairSummaries: z.array(z.string()).optional()
})

const agentContractHealBodySchema = healBodySchema.extend({
  agentMode: z.enum(['structured', 'text']).optional(),
  agentInstructions: z.string().optional(),
  agentOutputSchema: z.record(z.string(), z.unknown()).optional()
})

const diagnoseBodySchema = z.object({
  plan: z.unknown(),
  steps: z.array(
    z.object({
      nodeId: z.string(),
      nodeType: z.string(),
      label: z.string(),
      status: z.enum(['ok', 'warning', 'error', 'skipped']),
      output: z.unknown().optional(),
      message: z.string().optional(),
      inputSnapshot: z.unknown().optional()
    })
  )
})

const analyzeBodySchema = z.object({
  failedSteps: z.array(
    z.object({
      nodeId: z.string(),
      label: z.string().optional(),
      message: z.string(),
      nodeType: z.string().optional()
    })
  ),
  shapeFailures: z
    .array(z.object({ nodeId: z.string(), message: z.string() }))
    .optional(),
  priorRepairSummaries: z.array(z.string()).optional(),
  stepSamples: z
    .array(
      z.object({
        nodeId: z.string(),
        output: z.unknown().optional(),
        message: z.string().optional(),
        status: z.string().optional()
      })
    )
    .optional(),
  phaseNotes: z
    .array(
      z.object({
        nodeId: z.string(),
        plan: z.string().optional(),
        outputShape: z.string().optional()
      })
    )
    .optional()
})

const packageHealBodySchema = z.object({
  flowId: z.string().min(1),
  attempt: z.number().int().positive().default(1),
  maxAttempts: z.number().int().positive().default(2),
  analysisHint: z.string().optional(),
  failedSteps: z
    .array(
      z.object({
        nodeId: z.string(),
        label: z.string().optional(),
        message: z.string()
      })
    )
    .optional(),
  shapeFailures: z
    .array(z.object({ nodeId: z.string(), message: z.string() }))
    .optional(),
  priorRepairSummaries: z.array(z.string()).optional(),
  phaseNotes: z
    .array(
      z.object({
        nodeId: z.string(),
        plan: z.string().optional(),
        outputShape: z.string().optional()
      })
    )
    .optional(),
  stepSamples: z
    .array(
      z.object({
        nodeId: z.string(),
        status: z.string().optional(),
        message: z.string().optional(),
        output: z.unknown().optional()
      })
    )
    .optional()
})

export function registerFlowVerifyRoutes() {
  return [
    registerApiRoute('/ag/flow-verify/diagnose', {
      method: 'POST',
      requiresAuth: false,
      handler: async (c) => {
        const parsed = diagnoseBodySchema.safeParse(await c.req.json())
        if (!parsed.success) {
          return c.json({ ok: false, error: parsed.error.message }, 400)
        }
        const plan = parsed.data.plan as FlowPlan
        const shapeFailures = collectShapeFailures(plan, parsed.data.steps)
        const diagnosis = diagnoseVerifyFailure({
          plan,
          steps: parsed.data.steps,
          shapeFailures
        })
        return c.json({ ok: true, diagnosis, shapeFailures })
      }
    }),
    registerApiRoute('/ag/flow-verify/analyze', {
      method: 'POST',
      requiresAuth: false,
      handler: async (c) => {
        const parsed = analyzeBodySchema.safeParse(await c.req.json())
        if (!parsed.success) {
          return c.json({ ok: false, error: parsed.error.message }, 400)
        }
        try {
          const analysis = await evalVerifyAnalyze(flowVerifyAnalyzeAgent, parsed.data)
          return c.json({ ok: true, analysis })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          return c.json({ ok: false, error: message }, 500)
        }
      }
    }),
    registerApiRoute('/ag/flow-verify/heal-package', {
      method: 'POST',
      requiresAuth: false,
      handler: async (c) => {
        const parsed = packageHealBodySchema.safeParse(await c.req.json())
        if (!parsed.success) {
          return c.json({ ok: false, error: parsed.error.message }, 400)
        }
        try {
          const result = await evalFlowPackageHeal(flowPackageHealAgent, parsed.data)
          return c.json({ ok: true, summary: result.summary })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          return c.json({ ok: false, error: message }, 500)
        }
      }
    }),
    registerApiRoute('/ag/flow-verify/heal', {
      method: 'POST',
      requiresAuth: false,
      handler: async (c) => {
        const parsed = healBodySchema.safeParse(await c.req.json())
        if (!parsed.success) {
          return c.json({ ok: false, error: parsed.error.message }, 400)
        }
        try {
          const result = await evalNodeRuntimeHeal(flowRepairAgent, parsed.data)
          return c.json({
            ok: true,
            nodeId: result.nodeId,
            summary: result.summary,
            sourceAfter: result.sourceAfter
          })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          return c.json({ ok: false, error: message }, 500)
        }
      }
    }),
    registerApiRoute('/ag/flow-verify/heal-agent-contract', {
      method: 'POST',
      requiresAuth: false,
      handler: async (c) => {
        const parsed = agentContractHealBodySchema.safeParse(await c.req.json())
        if (!parsed.success) {
          return c.json({ ok: false, error: parsed.error.message }, 400)
        }
        try {
          const result = await evalAgentContractHeal(
            flowAgentContractRepairAgent,
            parsed.data
          )
          return c.json({
            ok: true,
            nodeId: result.nodeId,
            summary: result.summary,
            agentMode: result.agentMode,
            agentInstructions: result.agentInstructions,
            agentOutputSchema: result.agentOutputSchema ?? null,
            outputShape: result.outputShape ?? null
          })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          return c.json({ ok: false, error: message }, 500)
        }
      }
    })
  ]
}
