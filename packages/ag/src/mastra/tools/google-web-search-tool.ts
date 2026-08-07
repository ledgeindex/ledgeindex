import { createTool } from '@mastra/core/tools'
import { z } from 'zod'

const searchResultSchema = z.object({
  rank: z.number().int().positive(),
  url: z.string(),
  title: z.string(),
  snippet: z.string().optional(),
})

export const googleWebSearchTool = createTool({
  id: 'google_web_search',
  description:
    'Search the web with Google Search grounding. Returns ranked sources (title, url, snippet). Review multiple results before picking a docs page — the first result is not always the best official documentation URL.',
  inputSchema: z.object({
    query: z.string().min(2).describe('Search query, e.g. "mastra a2a agent-to-agent docs"'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    query: z.string(),
    answer: z.string(),
    sources: z.array(searchResultSchema),
    webSearchQueries: z.array(z.string()),
    errors: z.array(z.string()).optional(),
  }),
  execute: async ({ query }) => {
    const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim()
    if (!apiKey) {
      return {
        ok: false,
        query,
        answer: '',
        sources: [],
        webSearchQueries: [],
        errors: ['GOOGLE_GENERATIVE_AI_API_KEY (or GOOGLE_API_KEY) is not set'],
      }
    }

    try {
      const { GoogleGenAI } = await import('@google/genai')
      const ai = new GoogleGenAI({ apiKey })
      const model = process.env.DOCS_RESEARCH_GEMINI_MODEL?.trim() || 'gemini-2.5-flash'

      const response = await ai.models.generateContent({
        model,
        contents: [
          'You are a helpful web search assistant.',
          'Use Google Search grounding to find accurate, up-to-date information.',
          'Answer concisely. Prefer official documentation over blogs when relevant.',
          '',
          `Query: ${query}`,
        ].join('\n'),
        config: {
          tools: [{ googleSearch: {} }],
        },
      })

      const answer = String(response.text ?? '').trim()
      const groundingMetadata = response.candidates?.[0]?.groundingMetadata
      const { sources: rawSources, webSearchQueries } =
        buildSearchSourcesFromGroundingMetadata(groundingMetadata)

      const sources = await Promise.all(
        rawSources.map(async (row, index) => ({
          rank: index + 1,
          url: row.url.includes('vertexaisearch.cloud.google.com')
            ? await resolveGoogleGroundingRedirectUrl(row.url)
            : row.url,
          title: row.title,
          ...(row.snippet ? { snippet: row.snippet } : {}),
        })),
      )

      return {
        ok: true,
        query,
        answer,
        sources,
        webSearchQueries,
      }
    } catch (error) {
      return {
        ok: false,
        query,
        answer: '',
        sources: [],
        webSearchQueries: [],
        errors: [error instanceof Error ? error.message : 'google search failed'],
      }
    }
  },
})

async function resolveGoogleGroundingRedirectUrl(url: string): Promise<string> {
  try {
    const response = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AutomationGhost/1.0)' },
    })
    return response.url || url
  } catch {
    return url
  }
}

function truncateSearchSnippet(text: string, maxLen: number): string {
  const t = text.replace(/\s+/g, ' ').trim()
  if (t.length <= maxLen) return t
  return `${t.slice(0, maxLen - 1)}…`
}

function buildSearchSourcesFromGroundingMetadata(groundingMetadata: unknown): {
  sources: Array<{ url: string; title: string; snippet?: string }>
  webSearchQueries: string[]
} {
  const md = groundingMetadata as Record<string, unknown> | null | undefined
  if (!md || typeof md !== 'object') {
    return { sources: [], webSearchQueries: [] }
  }

  const chunks = Array.isArray(md.groundingChunks) ? md.groundingChunks : []
  const webSearchQueries = Array.isArray(md.webSearchQueries)
    ? md.webSearchQueries.map((q) => String(q ?? '').trim()).filter(Boolean)
    : []

  const snippetsByChunkIndex = new Map<number, string>()
  const supports = Array.isArray(md.groundingSupports) ? md.groundingSupports : []
  for (const support of supports) {
    const s = support as Record<string, unknown>
    const segment = s.segment as Record<string, unknown> | undefined
    const segText = typeof segment?.text === 'string' ? segment.text.trim() : ''
    if (!segText) continue
    const indices = Array.isArray(s.groundingChunkIndices) ? s.groundingChunkIndices : []
    for (const idx of indices) {
      const n = Number(idx)
      if (!Number.isFinite(n) || n < 0) continue
      const existing = snippetsByChunkIndex.get(n) || ''
      const merged = existing ? `${existing} ${segText}` : segText
      snippetsByChunkIndex.set(n, truncateSearchSnippet(merged, 280))
    }
  }

  const raw: Array<{ url: string; title: string; snippet?: string }> = []
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i] as Record<string, unknown>
    const web = chunk?.web as Record<string, unknown> | undefined
    const uri = typeof web?.uri === 'string' ? web.uri.trim() : ''
    if (!uri) continue
    const title = typeof web?.title === 'string' ? web.title.trim() : ''
    const snippet = snippetsByChunkIndex.get(i)
    raw.push({
      url: uri,
      title: title || uri,
      ...(snippet ? { snippet } : {}),
    })
  }

  const seen = new Set<string>()
  const sources: typeof raw = []
  for (const row of raw) {
    if (seen.has(row.url)) continue
    seen.add(row.url)
    sources.push(row)
  }

  return { sources, webSearchQueries }
}
