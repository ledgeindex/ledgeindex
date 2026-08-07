import { z } from 'zod'

export const planDocsFindingSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
})

export const planFetchedSourceSchema = z.object({
  url: z.string().url(),
  title: z.string().min(1),
  excerpt: z.string().optional(),
})

export const planDocsCodeSnippetSchema = z.object({
  language: z.string().nullable().optional(),
  section: z.string().nullable().optional(),
  code: z.string().min(1),
})

export type PlanDocsFinding = z.infer<typeof planDocsFindingSchema>
export type PlanFetchedSource = z.infer<typeof planFetchedSourceSchema>
export type PlanDocsCodeSnippet = z.infer<typeof planDocsCodeSnippetSchema>
