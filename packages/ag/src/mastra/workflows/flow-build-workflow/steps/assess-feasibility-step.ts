import { createStep } from '@mastra/core/workflows'
import { z } from 'zod'
import { DEFAULT_CAPABILITY_CATALOG } from '../../../../lib/builtin-catalog'
import { flowPlanSchema } from '../../../../lib/flow-plan'
import { assessPlanFeasibility } from '../../../../lib/plan-feasibility'

export const assessFeasibilityStep = createStep({
  id: 'assess-feasibility-step',
  description: 'Assess plan achievability against the capability catalog',
  inputSchema: flowPlanSchema,
  outputSchema: flowPlanSchema,
  execute: async ({ inputData }) => {
    const feasibility = assessPlanFeasibility(inputData, DEFAULT_CAPABILITY_CATALOG)
    return {
      ...inputData,
      // Roll phase/step dependencies[] into plan-level install map.
      suggestedDependencies: {
        ...(inputData.suggestedDependencies ?? {}),
        ...feasibility.packages.suggested
      },
      feasibility
    }
  }
})
