export type WorkspaceSearchResult = {
  filePath: string
  label: string
  chunkIndex: number
  text: string
  score: number
}

export type WorkspaceSearchResponse = {
  ok: boolean
  query: string
  results: WorkspaceSearchResult[]
  error?: string
}

const DEFAULT_BRIDGE_URL = 'http://127.0.0.1:4129'

function ledgeindexApiBase(): string {
  const port = process.env.AG_SERVER_PORT ?? process.env.PORT ?? '3010'
  return (
    process.env.LEDGEINDEX_API_BASE?.trim() ||
    process.env.MASTRA_BASE_URL?.replace(/\/mastra\/?$/, '') ||
    `http://127.0.0.1:${port}`
  )
}

export async function searchWorkspaceViaLedgeIndex(
  query: string,
  topK = 5,
  timeoutMs = 30_000,
): Promise<WorkspaceSearchResponse> {
  const trimmed = query.trim()
  if (!trimmed) {
    return { ok: false, query: '', results: [], error: 'query is required' }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(`${ledgeindexApiBase()}/api/ag/workspace/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: trimmed, topK }),
      signal: controller.signal,
    })

    const body = (await response.json()) as WorkspaceSearchResponse
    if (!response.ok) {
      return {
        ok: false,
        query: trimmed,
        results: [],
        error: body.error ?? `LedgeIndex workspace search failed (${response.status})`,
      }
    }
    return body
  } catch (error) {
    const message =
      error instanceof Error
        ? error.name === 'AbortError'
          ? 'LedgeIndex workspace search timed out'
          : error.message
        : String(error)
    return { ok: false, query: trimmed, results: [], error: message }
  } finally {
    clearTimeout(timer)
  }
}

export function desktopBridgeBaseUrl(): string {
  return process.env.AUTOMATIONGHOST_BRIDGE_URL?.trim() || DEFAULT_BRIDGE_URL
}

export async function searchWorkspaceViaBridge(
  query: string,
  topK = 5,
  timeoutMs = 30_000
): Promise<WorkspaceSearchResponse> {
  const trimmed = query.trim()
  if (!trimmed) {
    return { ok: false, query: '', results: [], error: 'query is required' }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(`${desktopBridgeBaseUrl()}/workspace/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: trimmed, topK }),
      signal: controller.signal
    })

    const body = (await response.json()) as WorkspaceSearchResponse
    if (!response.ok) {
      return {
        ok: false,
        query: trimmed,
        results: [],
        error: body.error ?? `Workspace search failed (${response.status})`
      }
    }
    return body
  } catch (error) {
    const message =
      error instanceof Error
        ? error.name === 'AbortError'
          ? 'Workspace search timed out'
          : error.message
        : String(error)
    return { ok: false, query: trimmed, results: [], error: message }
  } finally {
    clearTimeout(timer)
  }
}

export type FlowRunBridgeStep = {
  nodeId: string
  nodeType: string
  label: string
  status: string
  durationMs: number
  message?: string
  output?: unknown
}

export type FlowRunBridgeResponse = {
  ok: boolean
  runId?: string
  flowId?: string
  entryNodeId?: string
  status?: 'success' | 'failed'
  durationMs?: number
  error?: string
  availableNodeIds?: string[]
  filteredNodeIds?: string[]
  missingNodeIds?: string[]
  steps?: FlowRunBridgeStep[]
}

export async function runFlowViaBridge(
  input: {
    flowId: string
    entryNodeId?: string
    stopNodeId?: string
    dryRun?: boolean
    nodeIds?: string[]
  },
  timeoutMs = 10 * 60_000
): Promise<FlowRunBridgeResponse> {
  const flowId = input.flowId.trim()
  if (!flowId) return { ok: false, error: 'flowId is required' }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(`${desktopBridgeBaseUrl()}/flows/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        flowId,
        entryNodeId: input.entryNodeId,
        stopNodeId: input.stopNodeId,
        dryRun: input.dryRun,
        nodeIds: input.nodeIds
      }),
      signal: controller.signal
    })

    const body = (await response.json()) as FlowRunBridgeResponse
    if (!response.ok) {
      return {
        ok: false,
        error: body.error ?? `Flow run failed (${response.status})`
      }
    }
    return body
  } catch (error) {
    const message =
      error instanceof Error
        ? error.name === 'AbortError'
          ? 'Flow run timed out (desktop bridge)'
          : error.message
        : String(error)
    return { ok: false, error: message }
  } finally {
    clearTimeout(timer)
  }
}
