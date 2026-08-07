import { Agent } from '@mastra/core/agent'
import { z } from 'zod'
import type { FetchedDocsPage } from '../docs-fetcher'
import { DEFAULT_GOOGLE_MODEL } from '../models'
import { planDocsFindingSchema } from './plan-docs-research-fields'

export const docsFindingsOutputSchema = z.object({
  findings: z.array(planDocsFindingSchema).min(1).max(8),
})

const docsFindingsAgent = new Agent({
  id: 'docs-findings-agent',
  name: 'Docs Findings Summarizer',
  instructions: `Summarize fetched documentation for an automation planning UI.

Return 3–6 concise findings as title + description pairs.
Focus on facts useful for building an automation (concepts, APIs, setup, triggers, patterns).
Use short titles (2–6 words). Descriptions are 1–2 sentences.
Only use information present in the provided page content — do not invent details.`,
  model: DEFAULT_GOOGLE_MODEL,
})

function fallbackFindings(page: FetchedDocsPage) {
  if (page.excerpt.trim()) {
    return [{ title: page.title, description: page.excerpt.trim() }]
  }
  const first = page.textBlocks.find((block) => block.trim().length > 40)
  if (first) {
    return [{ title: page.title, description: first.slice(0, 320).trim() }]
  }
  return [{ title: page.title, description: 'Documentation page fetched successfully.' }]
}

export async function summarizeFetchedDocsFindings(input: {
  userPrompt: string
  page: FetchedDocsPage
}): Promise<z.infer<typeof docsFindingsOutputSchema>> {
  const textSample = input.page.textBlocks
    .slice(0, 10)
    .map((text, index) => `${index + 1}. ${text.slice(0, 420)}`)
    .join('\n')
  const codeSections = [
    ...new Set(input.page.codeBlocks.map((block) => block.section).filter(Boolean)),
  ].slice(0, 8)

  try {
    const response = await docsFindingsAgent.generate(
      `User automation request:
${input.userPrompt.trim()}

Fetched documentation page:
- Title: ${input.page.title}
- URL: ${input.page.url}
- Excerpt: ${input.page.excerpt || '(none)'}
- Code sections: ${codeSections.join(' · ') || '(none)'}

Page text sample:
${textSample || '(no prose blocks)'}`,
      { structuredOutput: { schema: docsFindingsOutputSchema } },
    )

    const raw = (response as { object?: unknown }).object
    const parsed = docsFindingsOutputSchema.safeParse(raw)
    if (parsed.success && parsed.data.findings.length > 0) {
      return parsed.data
    }
  } catch {
    /* fall through */
  }

  return { findings: fallbackFindings(input.page) }
}
