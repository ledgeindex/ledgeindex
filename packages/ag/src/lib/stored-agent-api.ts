import { DEFAULT_GOOGLE_MODEL } from './models'

const MASTRA_BASE_URL = (
  process.env.MASTRA_BASE_URL ??
  `http://127.0.0.1:${process.env.AG_SERVER_PORT ?? process.env.PORT ?? 3010}/mastra`
).replace(/\/$/, '')

type JsonRecord = Record<string, unknown>

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : null
}

function pickString(record: JsonRecord, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return undefined
}

export type EngineCatalogSnapshot = {
  tools: Array<{ id: string; description?: string }>
  agents: Array<{ id: string; name: string; description?: string }>
  workflows: Array<{ id: string; name: string; description?: string }>
}

export type SaveStoredAgentInput = {
  id: string
  name: string
  description?: string
  instructions: string
  toolIds?: string[]
  agentIds?: string[]
  workflowIds?: string[]
  model?: { provider: string; name: string }
  metadata?: Record<string, unknown>
}

export type SaveStoredAgentResult = {
  ok: boolean
  agentId?: string
  error?: string
  warnings?: string[]
  agent?: unknown
}

export function parseDefaultModel(): { provider: string; name: string } {
  const [provider, ...rest] = DEFAULT_GOOGLE_MODEL.split('/')
  return {
    provider: provider || 'google',
    name: rest.join('/') || 'gemini-3.5-flash'
  }
}

export async function fetchEngineCatalog(): Promise<EngineCatalogSnapshot> {
  const [toolsPayload, agentsPayload, workflowsPayload] = await Promise.all([
    fetch(`${MASTRA_BASE_URL}/tools`).then((r) => r.json()),
    fetch(`${MASTRA_BASE_URL}/agents`).then((r) => r.json()),
    fetch(`${MASTRA_BASE_URL}/workflows`).then((r) => r.json())
  ])

  const tools = Object.entries(asRecord(toolsPayload) ?? {}).map(([key, raw]) => {
    const entry = asRecord(raw) ?? {}
    const id = pickString(entry, 'id') ?? key
    return { id, description: pickString(entry, 'description') }
  })

  const agents = Object.entries(asRecord(agentsPayload) ?? {}).map(([key, raw]) => {
    const record = asRecord(raw) ?? {}
    const id = pickString(record, 'id') ?? key
    return {
      id,
      name: pickString(record, 'name', 'title') ?? id,
      description: pickString(record, 'description', 'instructions')?.slice(0, 200)
    }
  })

  const workflows = Object.entries(asRecord(workflowsPayload) ?? {}).map(([key, raw]) => {
    const entry = asRecord(raw) ?? {}
    const id = pickString(entry, 'name', 'id') ?? key
    return {
      id,
      name: pickString(entry, 'name', 'title') ?? id,
      description: pickString(entry, 'description')?.slice(0, 200)
    }
  })

  return { tools, agents, workflows }
}

export async function fetchStoredAgentIds(): Promise<Set<string>> {
  try {
    const response = await fetch(`${MASTRA_BASE_URL}/stored/agents`)
    if (!response.ok) return new Set()
    const payload = (await response.json()) as { agents?: Array<{ id?: string }> }
    return new Set(
      (payload.agents ?? []).flatMap((a) => (typeof a.id === 'string' ? [a.id] : []))
    )
  } catch {
    return new Set()
  }
}

export async function validateStoredAgentRefs(input: SaveStoredAgentInput): Promise<string[]> {
  const catalog = await fetchEngineCatalog()
  const storedIds = await fetchStoredAgentIds()
  const toolIds = new Set(catalog.tools.map((t) => t.id))
  const agentIds = new Set([...catalog.agents.map((a) => a.id), ...storedIds])
  const workflowIds = new Set(catalog.workflows.map((w) => w.id))
  const errors: string[] = []

  for (const toolId of input.toolIds ?? []) {
    if (!toolIds.has(toolId)) errors.push(`Unknown tool: ${toolId}`)
  }
  for (const agentId of input.agentIds ?? []) {
    if (!agentIds.has(agentId)) errors.push(`Unknown agent: ${agentId}`)
  }
  for (const workflowId of input.workflowIds ?? []) {
    if (!workflowIds.has(workflowId)) errors.push(`Unknown workflow: ${workflowId}`)
  }

  return errors
}

export async function saveStoredAgent(input: SaveStoredAgentInput): Promise<SaveStoredAgentResult> {
  const { evaluateStoredAgentDraft, smokeTestStoredAgent } = await import('./agent-eval')
  const evaluation = await evaluateStoredAgentDraft(input)
  if (!evaluation.valid) {
    return { ok: false, error: evaluation.errors.join('; '), warnings: evaluation.warnings }
  }

  const model = input.model ?? parseDefaultModel()
  const body: JsonRecord = {
    id: input.id,
    name: input.name,
    description: input.description ?? null,
    instructions: input.instructions,
    model: { provider: model.provider, name: model.name }
  }

  if (input.toolIds?.length) {
    body.tools = Object.fromEntries(input.toolIds.map((id) => [id, {}]))
  }
  if (input.agentIds?.length) {
    body.agents = Object.fromEntries(input.agentIds.map((id) => [id, {}]))
  }
  if (input.workflowIds?.length) {
    body.workflows = Object.fromEntries(input.workflowIds.map((id) => [id, {}]))
  }
  if (input.metadata && Object.keys(input.metadata).length > 0) {
    body.metadata = input.metadata
  }

  const response = await fetch(`${MASTRA_BASE_URL}/stored/agents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })

  if (!response.ok) {
    const text = await response.text()
    return { ok: false, error: text || `Save failed (${response.status})` }
  }

  const agent = await response.json()
  const agentId = pickString(asRecord(agent) ?? {}, 'id') ?? input.id
  const warnings = [...evaluation.warnings]
  const smokeError = await smokeTestStoredAgent(agentId)
  if (smokeError) warnings.push(`Post-save smoke test: ${smokeError}`)

  return { ok: true, agentId, agent, warnings: warnings.length > 0 ? warnings : undefined }
}
