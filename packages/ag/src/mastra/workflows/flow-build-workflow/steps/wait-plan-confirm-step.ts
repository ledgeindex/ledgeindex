import { createStep } from '@mastra/core/workflows'
import { z } from 'zod'
import { flowPlanSchema } from '../../../../lib/flow-plan'

export const waitPlanConfirmStep = createStep({
  id: 'wait-plan-confirm-step',
  description: 'Suspend until the user confirms or revises the plan',
  inputSchema: flowPlanSchema,
  suspendSchema: z.object({
    plan: flowPlanSchema,
    reason: z.literal('plan_ready')
  }),
  resumeSchema: z.object({
    confirmed: z.boolean(),
    flowId: z.string(),
    acknowledgedRisks: z.array(z.string()).optional(),
    revisionPrompt: z.string().optional()
  }),
  outputSchema: z.object({
    plan: flowPlanSchema,
    confirmed: z.boolean(),
    flowId: z.string(),
    acknowledgedRisks: z.array(z.string()).optional()
  }),
  execute: async ({ inputData, resumeData, suspend }) => {
    if (!resumeData) {
      return await suspend({
        plan: inputData,
        reason: 'plan_ready' as const
      })
    }

    if (!resumeData.confirmed) {
      throw new Error('Plan was not confirmed')
    }

    return {
      plan: inputData,
      confirmed: true,
      flowId: resumeData.flowId,
      acknowledgedRisks: resumeData.acknowledgedRisks
    }
  }
})
