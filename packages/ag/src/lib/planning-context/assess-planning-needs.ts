import { planningGateAgent } from '../../mastra/agents/planning-gate-agent'
import {
  planningGateDecisionSchema,
  type PlanningGateDecision,
} from './planning-gate-schema'
import type { PlanningNeedsAssessment } from './types'
import {
  buildPlanningRequestContext,
  type PlanningModelSelection,
} from '../planning-model'

function toAssessment(decision: PlanningGateDecision): PlanningNeedsAssessment {
  return {
    gates: {
      docs: decision.docs,
      integrations: decision.integrations,
    },
    docsUrl: decision.docsUrl,
    docsQuery: decision.docsSearchQuery,
    reasons: {
      docs: decision.docsReason,
      integrations: decision.integrationsReason,
    },
  }
}

/**
 * AI gate: one structured-output call decides docs / integrations enrichment.
 */
export async function assessPlanningNeeds(
  prompt: string,
  model?: PlanningModelSelection
): Promise<PlanningNeedsAssessment> {
  const response = await planningGateAgent.generate(
    `User automation request:\n${prompt.trim()}`,
    {
      structuredOutput: { schema: planningGateDecisionSchema },
      requestContext: buildPlanningRequestContext(model),
    },
  )

  const raw = (response as { object?: unknown }).object
  const decision = planningGateDecisionSchema.parse(raw ?? {})
  return toAssessment(decision)
}
