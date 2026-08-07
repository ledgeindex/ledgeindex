import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { resolveGoogleGeminiModelId } from '../../lib/request-context-model'

const DEFAULT_MAPS_GEMINI_MODEL = 'gemini-3.5-flash'
const MAPS_INTERACTION_TIMEOUT_MS = 300_000

type PlaceCitation = { name?: string; url?: string; snippet?: string }

function extractPlaceCitations(interaction: unknown): PlaceCitation[] {
  const steps = Array.isArray((interaction as { steps?: unknown[] })?.steps)
    ? (interaction as { steps: unknown[] }).steps
    : []
  const out: PlaceCitation[] = []

  for (const step of steps) {
    if (String((step as { type?: string })?.type ?? '') !== 'model_output') continue
    const content = Array.isArray((step as { content?: unknown[] })?.content)
      ? (step as { content: unknown[] }).content
      : []
    for (const block of content) {
      if ((block as { type?: string })?.type !== 'text') continue
      const annotations = Array.isArray((block as { annotations?: unknown[] })?.annotations)
        ? (block as { annotations: unknown[] }).annotations
        : []
      for (const ann of annotations) {
        if (String((ann as { type?: string })?.type ?? '') !== 'place_citation') continue
        const a = ann as Record<string, unknown>
        out.push({
          name: String(a.name ?? a.title ?? '').trim() || undefined,
          url: String(a.url ?? a.uri ?? '').trim() || undefined,
          snippet: typeof a.snippet === 'string' ? a.snippet : undefined
        })
      }
    }
  }

  return out
}

function extractInteractionAnswer(interaction: unknown): string {
  return String((interaction as { output_text?: string })?.output_text ?? '').trim()
}

async function geocodeLocationLabel(
  label: string
): Promise<{ latitude: number; longitude: number } | null> {
  const q = label.trim()
  if (!q) return null

  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1`
  const res = await fetch(url, {
    headers: { 'User-Agent': 'AutomationGhost/1.0 (local places search)' }
  })
  if (!res.ok) return null

  const rows = (await res.json()) as Array<{ lat?: string; lon?: string }>
  const first = rows?.[0]
  const latitude = Number(first?.lat)
  const longitude = Number(first?.lon)
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null
  return { latitude, longitude }
}

async function resolveMapsCoordinates(input: {
  location?: string
  latitude?: number
  longitude?: number
}): Promise<
  { latitude: number; longitude: number; locationLabel?: string } | { error: string }
> {
  const inputLat = input.latitude
  const inputLon = input.longitude
  if (Number.isFinite(inputLat) && Number.isFinite(inputLon)) {
    return { latitude: inputLat!, longitude: inputLon! }
  }

  const label = String(input.location ?? '').trim()
  if (!label) {
    return { error: 'Provide a location (city/region) or latitude/longitude.' }
  }

  const coords = await geocodeLocationLabel(label)
  if (!coords) {
    return { error: `Could not geocode location "${label}".` }
  }
  return { ...coords, locationLabel: label }
}

export const searchPlacesTool = createTool({
  id: 'search_places',
  description:
    'Find local businesses, shops, restaurants, and services via Google Maps grounding. Use for companies or places in a city/area — not for general web articles (use google_web_search).',
  inputSchema: z.object({
    query: z.string().min(1).describe('What to find, e.g. "Italian restaurants" or "electricians"'),
    location: z.string().optional().describe('City or region, e.g. "Berlin, Germany"'),
    latitude: z.number().optional(),
    longitude: z.number().optional()
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    query: z.string(),
    location: z.string().optional(),
    latitude: z.number().optional(),
    longitude: z.number().optional(),
    answer: z.string().optional(),
    sources: z
      .array(
        z.object({
          url: z.string(),
          title: z.string(),
          snippet: z.string().optional()
        })
      )
      .optional(),
    message: z.string().optional()
  }),
  execute: async ({ query, location, latitude, longitude }, context) => {
    const trimmedQuery = String(query ?? '').trim()
    const coordsResult = await resolveMapsCoordinates({ location, latitude, longitude })

    if ('error' in coordsResult) {
      return {
        ok: false,
        query: trimmedQuery,
        location,
        message: coordsResult.error
      }
    }

    const { latitude: resolvedLat, longitude: resolvedLon, locationLabel } = coordsResult
    const geminiModelId = resolveGoogleGeminiModelId(context, DEFAULT_MAPS_GEMINI_MODEL)
    const locationHint = locationLabel ? ` near ${locationLabel}` : ''
    const prompt = [
      trimmedQuery + locationHint,
      '',
      'Return a helpful answer grounded in Google Maps data.',
      'For each place include: business name, address or area, website when available, phone when available, rating/review count when available, and a short factual summary.',
      'Only include real businesses from Maps — do not invent listings.'
    ].join('\n')

    try {
      const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim()
      if (!apiKey) {
        throw new Error('GOOGLE_GENERATIVE_AI_API_KEY (or GOOGLE_API_KEY) is not set')
      }

      const { GoogleGenAI } = await import('@google/genai')
      const ai = new GoogleGenAI({ apiKey })
      const interaction = await ai.interactions.create(
        {
          model: geminiModelId,
          input: prompt,
          tools: [
            {
              type: 'google_maps',
              latitude: resolvedLat,
              longitude: resolvedLon
            }
          ]
        },
        { timeout: MAPS_INTERACTION_TIMEOUT_MS }
      )

      const status = String((interaction as { status?: string })?.status ?? '')
      if (status === 'failed') {
        const errMsg = String((interaction as { error?: string })?.error ?? 'Maps search failed')
        throw new Error(errMsg)
      }

      const answer = extractInteractionAnswer(interaction)
      const placeCitations = extractPlaceCitations(interaction)
      const seenUrls = new Set<string>()
      const sources = placeCitations
        .map((place) => {
          const url = String(place.url ?? '').trim()
          if (!url || seenUrls.has(url)) return null
          seenUrls.add(url)
          const title = String(place.name ?? url).trim() || url
          return {
            url,
            title,
            ...(place.snippet ? { snippet: place.snippet } : {})
          }
        })
        .filter(Boolean) as Array<{ url: string; title: string; snippet?: string }>

      const ok = Boolean(answer) || sources.length > 0
      return {
        ok,
        query: trimmedQuery,
        location: locationLabel,
        latitude: resolvedLat,
        longitude: resolvedLon,
        answer: answer || undefined,
        sources: sources.length > 0 ? sources : undefined,
        message: ok ? undefined : 'No grounded places found for this query'
      }
    } catch (error) {
      return {
        ok: false,
        query: trimmedQuery,
        location: locationLabel,
        latitude: resolvedLat,
        longitude: resolvedLon,
        message: error instanceof Error ? error.message : 'Maps search failed'
      }
    }
  }
})
