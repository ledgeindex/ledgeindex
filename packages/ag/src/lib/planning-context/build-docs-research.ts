import type { FetchedDocsPage } from '../docs-fetcher'
import type { PlanDocsResearch } from './types'
import {
  type PlanDocsCodeSnippet,
  type PlanDocsFinding,
  type PlanFetchedSource,
} from './plan-docs-research-fields'
import { summarizeFetchedDocsFindings } from './summarize-fetched-docs'

const MAX_CODE_SNIPPETS = 6
const MAX_CODE_CHARS = 1800

function normalizeRawCode(code: string): string {
  return code.replace(/\r\n/g, '\n').replace(/\t/g, '  ').trim()
}

/** Light formatting when docs ship minified one-line examples. */
export function formatCodeForDisplay(code: string): string {
  const normalized = normalizeRawCode(code)
  const lineCount = normalized.split('\n').length
  if (lineCount > 1 || normalized.length < 100) return normalized

  return normalized
    .replace(/;\s*(?=[A-Za-z_$])/g, ';\n')
    .replace(/\{\s*/g, '{\n  ')
    .replace(/\}\s*/g, '\n}\n')
    .replace(/,\s*(?=[A-Za-z_$"'`])/g, ',\n  ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function truncateCodePreservingLines(code: string, max: number): string {
  if (code.length <= max) return code
  const slice = code.slice(0, max)
  const lastNewline = slice.lastIndexOf('\n')
  if (lastNewline > max * 0.45) {
    return `${slice.slice(0, lastNewline).trimEnd()}\n…`
  }
  return `${slice.trimEnd()}…`
}

export function codeSnippetsFromPage(page: FetchedDocsPage): PlanDocsCodeSnippet[] {
  return page.codeBlocks.slice(0, MAX_CODE_SNIPPETS).map((block) => {
    const formatted = formatCodeForDisplay(block.code)
    return {
      language: block.language,
      section: block.section,
      code: truncateCodePreservingLines(formatted, MAX_CODE_CHARS),
    }
  })
}
export function fetchedSourcesFromPage(page: FetchedDocsPage): PlanFetchedSource[] {
  return [
    {
      url: page.url,
      title: page.title,
      excerpt: page.excerpt.trim() || undefined,
    },
  ]
}

export async function buildDocsResearchFromPage(input: {
  userPrompt: string
  page: FetchedDocsPage
  status: 'fetch_only' | 'search_and_fetch'
  reason: string
  query?: string
}): Promise<Pick<
  PlanDocsResearch,
  | 'status'
  | 'reason'
  | 'query'
  | 'chosenUrl'
  | 'pageTitle'
  | 'excerpt'
  | 'textPreview'
  | 'codeBlockCount'
  | 'findings'
  | 'fetchedSources'
  | 'codeSnippets'
>> {
  const { findings } = await summarizeFetchedDocsFindings({
    userPrompt: input.userPrompt,
    page: input.page,
  })

  return {
    status: input.status,
    reason: input.reason,
    query: input.query,
    chosenUrl: input.page.url,
    pageTitle: input.page.title,
    excerpt: input.page.excerpt,
    textPreview: input.page.textBlocks.slice(0, 6).map((text) => text.slice(0, 480)),
    codeBlockCount: input.page.metrics.codeBlockCount,
    findings: findings as PlanDocsFinding[],
    fetchedSources: fetchedSourcesFromPage(input.page),
    codeSnippets: codeSnippetsFromPage(input.page),
  }
}
