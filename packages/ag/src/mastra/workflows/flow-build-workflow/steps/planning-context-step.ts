import { createStep } from '@mastra/core/workflows'
import { z } from 'zod'
import { flowPlanSchema } from '../../../../lib/flow-plan'
import { planningContextSchema } from '../../../../lib/planning-context/types'
import { flowBuildMountedContextSchema } from '../../../../lib/planning-context/mounted-context'
import {
  assessPlanningNeeds,
  runPlanningEnrichments,
} from '../../../../lib/planning-context'

const workflowPlanInputSchema = z.object({
  prompt: z.string(),
  flowKind: z.enum(['manual', 'event', 'branching', 'agentic']).optional(),
  priorPlan: flowPlanSchema.optional(),
  revisionPrompt: z.string().optional(),
  flowId: z.string(),
  mountedContext: flowBuildMountedContextSchema.optional(),
  modelId: z.string().optional(),
  lmStudioModelId: z.string().optional(),
  lmStudioBaseUrl: z.string().optional(),
})

export const planningContextOutputSchema = workflowPlanInputSchema.extend({
  planningContext: planningContextSchema,
})

export const planningContextStep = createStep({
  id: 'planning-context-step',
  description: 'Assess planning gates and run docs/integration/skill enrichments',
  inputSchema: workflowPlanInputSchema,
  outputSchema: planningContextOutputSchema,
  execute: async ({ inputData, writer }) => {
    const emit = async (phase: string, message: string): Promise<void> => {
      await writer?.write({ type: 'planning-progress', phase, message })
    }

    await emit('assess', 'Deciding what planning research is needed…')
    const model = {
      modelId: inputData.modelId,
      lmStudioModelId: inputData.lmStudioModelId,
      lmStudioBaseUrl: inputData.lmStudioBaseUrl,
    }
    const needs = await assessPlanningNeeds(inputData.prompt, model)

    const planningContext = await runPlanningEnrichments(inputData.prompt, needs, async (event) => {
      await emit(event.phase, event.message)
    })

    return {
      ...inputData,
      planningContext,
    }
  },
})
