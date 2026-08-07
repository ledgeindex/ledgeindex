import { z } from 'zod'
import {
  planDocsCodeSnippetSchema,
  planDocsFindingSchema,
  planFetchedSourceSchema,
} from './plan-docs-research-fields'

export const planningGateDocsSchema = z.enum(['skip', 'fetch_only', 'search_and_fetch'])

/** Reserved for integration picking (stub enricher until implemented). */
export const planningGateIntegrationsSchema = z.enum(['skip', 'pick'])

export const planDocsSearchSourceSchema = z.object({
  rank: z.number().int().positive(),
  url: z.string(),
  title: z.string(),
  snippet: z.string().optional(),
})

export const planDocsResearchSchema = z.object({
  status: z.enum(['skipped', 'fetch_only', 'search_and_fetch', 'failed']),
  reason: z.string(),
  query: z.string().optional(),
  chosenUrl: z.string().optional(),
  pageTitle: z.string().optional(),
  excerpt: z.string().optional(),
  textPreview: z.array(z.string()).max(8).optional(),
  codeBlockCount: z.number().int().nonnegative().optional(),
  /** @deprecated Search hits are not shown in the plan UI — use fetchedSources only */
  searchSources: z.array(planDocsSearchSourceSchema).optional(),
  findings: z.array(planDocsFindingSchema).max(12).optional(),
  fetchedSources: z.array(planFetchedSourceSchema).max(4).optional(),
  codeSnippets: z.array(planDocsCodeSnippetSchema).max(8).optional(),
  error: z.string().optional(),
})

export const planningContextSchema = z.object({
  gates: z.object({
    docs: planningGateDocsSchema,
    integrations: planningGateIntegrationsSchema,
  }),
  docs: planDocsResearchSchema.optional(),
  /** Future: integration picks from builtin-catalog */
  integrations: z
    .object({
      status: z.literal('not_implemented'),
      reason: z.string(),
    })
    .optional(),
})

export type PlanningGateDocs = z.infer<typeof planningGateDocsSchema>
export type PlanDocsResearch = z.infer<typeof planDocsResearchSchema>
export type PlanningContextBundle = z.infer<typeof planningContextSchema>

export type PlanningNeedsAssessment = {
  gates: PlanningContextBundle['gates']
  docsUrl?: string
  docsQuery?: string
  reasons?: {
    docs?: string
    integrations?: string
  }
}

export type PlanningProgressEvent = {
  type: 'planning-progress'
  phase:
    | 'assess'
    | 'docs_search'
    | 'docs_fetch'
    | 'docs_pick'
    | 'docs_skip'
    | 'docs_summarize'
    | 'inquiry_assess'
    | 'inquiry_ready'
    | 'inquiry_skip'
    | 'architect'
  message: string
}
