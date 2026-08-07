import { createStep } from '@mastra/core/workflows'
import { z } from 'zod'
import { assessUserInquiryNeeds } from '../../../../lib/user-inquiry/assess-inquiry-needs'
import { formatClarifyAnswersForPrompt } from '../../../../lib/user-inquiry/format-answers'
import {
  clarifyQuestionSchema,
  clarifyResumeSchema
} from '../../../../lib/user-inquiry/schema'
import { planningContextOutputSchema } from './planning-context-step'

export const userInquiryOutputSchema = planningContextOutputSchema.extend({
  clarifyQuestions: z.array(clarifyQuestionSchema).optional(),
  clarifySkipped: z.boolean().optional()
})

export const userInquiryStep = createStep({
  id: 'user-inquiry-step',
  description: 'Optionally ask the user 1–3 clarifying questions after research',
  inputSchema: planningContextOutputSchema,
  suspendSchema: z.object({
    reason: z.literal('needs_clarification'),
    questions: z.array(clarifyQuestionSchema).min(1).max(3)
  }),
  resumeSchema: clarifyResumeSchema,
  outputSchema: userInquiryOutputSchema,
  execute: async ({ inputData, resumeData, suspend, suspendData, writer }) => {
    const emit = async (phase: string, message: string): Promise<void> => {
      await writer?.write({ type: 'planning-progress', phase, message })
    }

    // Plan revisions already have confirmed context — never re-ask.
    if (inputData.priorPlan || inputData.revisionPrompt) {
      await emit('inquiry_skip', 'Skipping questions for plan revision…')
      return {
        ...inputData,
        clarifySkipped: true
      }
    }

    if (!resumeData) {
      await emit('inquiry_assess', 'Checking if anything is still unclear…')

      const decision = await assessUserInquiryNeeds({
        prompt: inputData.prompt,
        planningContext: inputData.planningContext,
        model: {
          modelId: inputData.modelId,
          lmStudioModelId: inputData.lmStudioModelId,
          lmStudioBaseUrl: inputData.lmStudioBaseUrl
        }
      })

      if (!decision.needsClarification || decision.questions.length === 0) {
        await emit('inquiry_skip', 'Enough context — skipping questions…')
        return {
          ...inputData,
          clarifySkipped: true
        }
      }

      await emit('inquiry_ready', 'Waiting for your answers…')
      return await suspend({
        reason: 'needs_clarification' as const,
        questions: decision.questions
      })
    }

    if (resumeData.skipped) {
      await emit('inquiry_skip', 'Questions skipped — drafting with current context…')
      return {
        ...inputData,
        clarifyQuestions: suspendData?.questions,
        clarifySkipped: true
      }
    }

    const questions = suspendData?.questions ?? []
    const answersBlock = formatClarifyAnswersForPrompt(questions, resumeData.answers)
    const prompt = answersBlock ? `${inputData.prompt}\n\n${answersBlock}` : inputData.prompt

    await emit('inquiry_skip', 'Answers received — continuing to draft…')
    return {
      ...inputData,
      prompt,
      clarifyQuestions: questions,
      clarifySkipped: false
    }
  }
})
