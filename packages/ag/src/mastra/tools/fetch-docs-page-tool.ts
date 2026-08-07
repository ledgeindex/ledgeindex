import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { fetchDocsPage } from '../../lib/docs-fetcher'

export const fetchDocsPageTool = createTool({
  id: 'fetch_docs_page',
  description:
    'Fetch a documentation HTML page and extract prose text blocks and code blocks (with language when available). Use after picking the best URL from search results.',
  inputSchema: z.object({
    url: z.string().url().describe('Documentation page URL to fetch'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    url: z.string(),
    title: z.string(),
    excerpt: z.string(),
    textPreview: z.array(z.string()),
    codeBlocks: z.array(
      z.object({
        language: z.string().nullable(),
        section: z.string().nullable(),
        preview: z.string(),
        charCount: z.number(),
      }),
    ),
    metrics: z.object({
      textBlockCount: z.number(),
      codeBlockCount: z.number(),
      codeBlocksWithLanguage: z.number(),
    }),
    errors: z.array(z.string()).optional(),
  }),
  execute: async ({ url }) => {
    try {
      const page = await fetchDocsPage(url)
      return {
        ok: true,
        url: page.url,
        title: page.title,
        excerpt: page.excerpt,
        textPreview: page.textBlocks.slice(0, 5).map((t) => t.slice(0, 280)),
        codeBlocks: page.codeBlocks.map((block) => ({
          language: block.language,
          section: block.section,
          preview: block.code.slice(0, 320),
          charCount: block.code.length,
        })),
        metrics: {
          textBlockCount: page.metrics.textBlockCount,
          codeBlockCount: page.metrics.codeBlockCount,
          codeBlocksWithLanguage: page.metrics.codeBlocksWithLanguage,
        },
      }
    } catch (error) {
      return {
        ok: false,
        url,
        title: '',
        excerpt: '',
        textPreview: [],
        codeBlocks: [],
        metrics: {
          textBlockCount: 0,
          codeBlockCount: 0,
          codeBlocksWithLanguage: 0,
        },
        errors: [error instanceof Error ? error.message : 'fetch failed'],
      }
    }
  },
})
