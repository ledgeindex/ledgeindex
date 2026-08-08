import { createStep } from '@mastra/core/workflows'
import { z } from 'zod'
import { flowPlanSchema } from '../../../../lib/flow-plan'
import { compilePlanPreview } from '../../../../lib/plan-compile'

export const compilePreviewStep = createStep({
  id: 'compile-preview-step',
  description: 'Compile a read-only flow preview from the plan',
  inputSchema: flowPlanSchema,
  outputSchema: flowPlanSchema,
  execute: async ({ inputData }) => {
    const compiledPreview = compilePlanPreview(inputData)
    return {
      ...inputData,
      compiledPreview
    }
  }
})
