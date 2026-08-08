import { z } from 'zod'

export const planningGateDecisionSchema = z.object({
  docs: z.enum(['skip', 'fetch_only', 'search_and_fetch']),
  docsReason: z.string().min(1),
  docsUrl: z.string().url().optional(),
  docsSearchQuery: z.string().min(2).optional(),
  integrations: z.enum(['skip', 'pick']),
  integrationsReason: z.string().min(1),
})

export type PlanningGateDecision = z.infer<typeof planningGateDecisionSchema>
