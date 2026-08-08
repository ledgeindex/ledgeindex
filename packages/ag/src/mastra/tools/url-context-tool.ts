import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { resolveGoogleGeminiModelId } from '../../lib/request-context-model'

const DEFAULT_URL_CONTEXT_GEMINI_MODEL = 'gemini-3.5-flash'

function normalizeHttpUrl(raw: string): string {
  const trimmed = raw.trim()
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    throw new Error('Invalid URL. Provide a full http(s) URL.')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only http and https URLs are supported.')
  }
  return parsed.href
}

function isRetrievalSuccess(status: string | undefined): boolean {
  return String(status ?? '').toUpperCase().includes('SUCCESS')
}

export const urlContextTool = createTool({
  id: 'url_context',
  description:
    'Read a public http(s) URL via Google URL context. Returns a concise summary. Use when the user gives a specific URL — not for open-ended discovery (use google_web_search instead).',
  inputSchema: z.object({
    url: z.string().min(1).describe('Full http(s) URL to read')
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    url: z.string().optional(),
    title: z.string().optional(),
    retrievalStatus: z.string().optional(),
    summary: z.string().optional(),
    message: z.string().optional()
  }),
  execute: async ({ url }, context) => {
    const resolvedUrl = normalizeHttpUrl(url)
    const geminiModelId = resolveGoogleGeminiModelId(context, DEFAULT_URL_CONTEXT_GEMINI_MODEL)

    try {
      const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim()
      if (!apiKey) {
        throw new Error('GOOGLE_GENERATIVE_AI_API_KEY (or GOOGLE_API_KEY) is not set')
      }

      const { GoogleGenAI } = await import('@google/genai')
      const ai = new GoogleGenAI({ apiKey })
      const response = await ai.models.generateContent({
        model: geminiModelId,
        contents: [
          `Read the page at ${resolvedUrl}.`,
          'Return a concise factual summary of the main content (up to 8 bullet points).',
          'Do not invent information that is not on the page.'
        ].join('\n'),
        config: {
          tools: [{ urlContext: {} }]
        }
      })

      const candidate = response.candidates?.[0]
      const urlMeta = candidate?.urlContextMetadata?.urlMetadata?.[0]
      const retrievalStatus = String(urlMeta?.urlRetrievalStatus ?? '').trim() || undefined
      const title =
        String(candidate?.groundingMetadata?.groundingChunks?.[0]?.web?.title ?? '').trim() ||
        undefined
      const summary = String(response.text ?? '').trim() || undefined
      const ok = isRetrievalSuccess(retrievalStatus) && Boolean(summary)

      return {
        ok,
        url: resolvedUrl,
        title,
        retrievalStatus,
        summary,
        message: ok ? undefined : 'Failed to read URL content'
      }
    } catch (error) {
      return {
        ok: false,
        url: resolvedUrl,
        message: error instanceof Error ? error.message : 'Failed to read URL'
      }
    }
  }
})
