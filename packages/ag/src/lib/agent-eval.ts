import type { SaveStoredAgentInput } from './stored-agent-api'
import { parseDefaultModel, validateStoredAgentRefs } from './stored-agent-api'

const MASTRA_BASE_URL = `http://127.0.0.1:${process.env.MASTRA_PORT ?? 4130}`

const ALLOWED_MODELS = new Set([
  'google/gemini-3-flash-preview',
  'google/gemini-2.0-flash',
  'google/gemini-2.5-flash-preview',
  'openai/gpt-4.1-mini',
  'openai/gpt-4o-mini',
  'anthropic/claude-sonnet-4-6',
  'anthropic/claude-sonnet-4-20250514'
])

export type AgentEvalResult = {
  valid: boolean
  errors: string[]
  warnings: string[]
}

export async function evaluateStoredAgentDraft(
  input: SaveStoredAgentInput
): Promise<AgentEvalResult> {
  const errors: string[] = []
  const warnings: string[] = []

  if (!input.id.trim()) errors.push('Agent id is required')
  if (!input.name.trim()) errors.push('Agent name is required')
  if (!input.instructions.trim()) errors.push('Instructions are required')
  if (input.instructions.trim().length < 24) {
    warnings.push('Instructions are very short — agent may behave inconsistently')
  }

  const model = input.model ?? parseDefaultModel()
  const modelKey = `${model.provider}/${model.name}`
  if (!ALLOWED_MODELS.has(modelKey)) {
    warnings.push(`Model ${modelKey} is not in the desktop allowlist — saving with default`)
  }

  errors.push(...(await validateStoredAgentRefs(input)))

  return { valid: errors.length === 0, errors, warnings }
}

export async function smokeTestStoredAgent(agentId: string): Promise<string | null> {
  try {
    const response = await fetch(`${MASTRA_BASE_URL}/api/agents/${encodeURIComponent(agentId)}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Reply with exactly: smoke-ok' }]
      })
    })

    if (!response.ok) {
      return `Smoke test failed (${response.status})`
    }

    const payload = (await response.json()) as { text?: string }
    if (!payload.text?.trim()) {
      return 'Smoke test returned empty response'
    }
    return null
  } catch (error) {
    return error instanceof Error ? error.message : 'Smoke test failed'
  }
}
