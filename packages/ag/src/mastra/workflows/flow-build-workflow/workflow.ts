import { createWorkflow } from '@mastra/core/workflows'
import { z } from 'zod'
import { flowPlanSchema } from '../../../lib/flow-plan'
import { flowBuildMountedContextSchema } from '../../../lib/planning-context/mounted-context'
import { planStep } from './steps/plan-step'
import { planningContextStep } from './steps/planning-context-step'
import { userInquiryStep } from './steps/user-inquiry-step'
import { assessFeasibilityStep } from './steps/assess-feasibility-step'
import { compilePreviewStep } from './steps/compile-preview-step'
import { waitPlanConfirmStep } from './steps/wait-plan-confirm-step'
import { structureStep } from './steps/structure-step'
import { codegenOneNodeStep } from './steps/codegen-one-node-step'
import { configureControlNodesStep } from './steps/configure-control-nodes-step'
import { assembleBuildStep, buildCompleteSchema } from './steps/assemble-build-step'

export const flowBuildWorkflow = createWorkflow({
  id: 'flow-build-workflow',
  inputSchema: z.object({
    prompt: z.string(),
    flowKind: z.enum(['manual', 'event', 'branching', 'agentic']).optional(),
    priorPlan: flowPlanSchema.optional(),
    revisionPrompt: z.string().optional(),
    flowId: z.string(),
    mountedContext: flowBuildMountedContextSchema.optional(),
    modelId: z.string().optional(),
    lmStudioModelId: z.string().optional(),
    lmStudioBaseUrl: z.string().optional(),
  }),
  outputSchema: buildCompleteSchema
})
  .then(planningContextStep)
  .then(userInquiryStep)
  .then(planStep)
  .then(assessFeasibilityStep)
  .then(compilePreviewStep)
  .then(waitPlanConfirmStep)
  .then(structureStep)
  .map(async ({ inputData }) => inputData.codegenTasks, { id: 'extract-codegen-tasks' })
  .foreach(codegenOneNodeStep, { concurrency: 1 })
  .then(configureControlNodesStep)
  .then(assembleBuildStep)

flowBuildWorkflow.commit()
