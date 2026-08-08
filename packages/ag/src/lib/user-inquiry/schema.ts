import { z } from 'zod'

export const clarifyQuestionOptionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1)
})

export const clarifyQuestionSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  options: z.array(clarifyQuestionOptionSchema).min(2).max(6),
  allowCustom: z.boolean().default(true)
})

export const clarifyInquiryDecisionSchema = z.object({
  needsClarification: z.boolean(),
  reason: z.string().min(1),
  questions: z.array(clarifyQuestionSchema).max(3).default([])
})

export const clarifyAnswerSchema = z.object({
  questionId: z.string().min(1),
  optionIds: z.array(z.string()).default([]),
  customText: z.string().optional()
})

export const clarifySuspendPayloadSchema = z.object({
  reason: z.literal('needs_clarification'),
  questions: z.array(clarifyQuestionSchema).min(1).max(3)
})

export const clarifyResumeSchema = z.object({
  skipped: z.boolean().default(false),
  answers: z.array(clarifyAnswerSchema).default([])
})

export type ClarifyQuestion = z.infer<typeof clarifyQuestionSchema>
export type ClarifyInquiryDecision = z.infer<typeof clarifyInquiryDecisionSchema>
export type ClarifyAnswer = z.infer<typeof clarifyAnswerSchema>
export type ClarifySuspendPayload = z.infer<typeof clarifySuspendPayloadSchema>
