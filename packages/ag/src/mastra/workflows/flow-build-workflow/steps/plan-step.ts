import { createStep } from '@mastra/core/workflows'
import { flowPlanSchema } from '../../../../lib/flow-plan'
import { generateFlowPlanFromPrompt } from '../../../../lib/plan-generate'
import { userInquiryOutputSchema } from './user-inquiry-step'

export const planStep = createStep({
  id: 'plan-step',
  description: 'Generate a FlowPlan from the user prompt',
  inputSchema: userInquiryOutputSchema,
  outputSchema: flowPlanSchema,
  execute: async ({ inputData, writer }) => {
    const isRevision = Boolean(inputData.priorPlan)
    await writer?.write({
      type: 'planning-progress',
      phase: 'architect',
      message: isRevision
        ? 'Revision agent is updating your plan…'
        : 'Drafting your automation plan…',
    })

    return generateFlowPlanFromPrompt({
      prompt: inputData.prompt,
      flowKind: inputData.flowKind,
      priorPlan: inputData.priorPlan,
      revisionPrompt: inputData.revisionPrompt,
      planningContext: inputData.planningContext,
      mountedContext: inputData.mountedContext,
      model: {
        modelId: inputData.modelId,
        lmStudioModelId: inputData.lmStudioModelId,
        lmStudioBaseUrl: inputData.lmStudioBaseUrl,
      },
    })
  },
})
