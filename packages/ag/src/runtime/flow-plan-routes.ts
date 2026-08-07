import { registerApiRoute } from '@mastra/core/server'
import { z } from 'zod'
import { flowPlanSchema } from '../lib/flow-plan'
import { generateFlowPlanFromPrompt } from '../lib/plan-generate'

const draftBodySchema = z.object({
  prompt: z.string().min(1),
  priorPlan: flowPlanSchema.optional(),
  revisionPrompt: z.string().optional(),
  flowKind: z.enum(['manual', 'event', 'branching', 'agentic']).optional(),
  planningContext: flowPlanSchema.shape.planningContext.optional(),
  modelId: z.string().optional(),
  lmStudioModelId: z.string().optional(),
  lmStudioBaseUrl: z.string().optional()
})

/**
 * Lightweight draft FlowPlan for home "planner mode" — no full build workflow / suspends.
 */
export function registerFlowPlanRoutes() {
  return [
    registerApiRoute('/ag/flow-plan/draft', {
      method: 'POST',
      requiresAuth: false,
      handler: async (c) => {
        const parsed = draftBodySchema.safeParse(await c.req.json())
        if (!parsed.success) {
          return c.json({ ok: false, error: parsed.error.message }, 400)
        }
        try {
          const plan = await generateFlowPlanFromPrompt({
            prompt: parsed.data.prompt,
            flowKind: parsed.data.flowKind,
            priorPlan: parsed.data.priorPlan,
            revisionPrompt:
              parsed.data.revisionPrompt ??
              (parsed.data.priorPlan
                ? 'Update the plan phases to match the latest user request. Preserve what still fits.'
                : undefined),
            planningContext:
              parsed.data.planningContext ?? parsed.data.priorPlan?.planningContext,
            model: {
              modelId: parsed.data.modelId,
              lmStudioModelId: parsed.data.lmStudioModelId,
              lmStudioBaseUrl: parsed.data.lmStudioBaseUrl
            }
          })
          return c.json({ ok: true, plan })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          return c.json({ ok: false, error: message }, 500)
        }
      }
    })
  ]
}
