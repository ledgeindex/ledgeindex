/** Keep Flow Editor Ask AI tool results small for the LLM (full payloads stay in tool/UI). */

/** Max tokens sent to the model per step (history + tool results); safety ceiling for long Ask AI runs. */
export const FLOW_EDITOR_CONTEXT_TOKEN_LIMIT = 300_000

export function truncateForModel(text: string, maxChars: number): string {
  const t = text.trim()
  if (t.length <= maxChars) return t
  return `${t.slice(0, maxChars)}\n…(truncated, ${t.length - maxChars} more chars)`
}

export function truncateJsonForModel(value: unknown, maxChars = 1_800): string {
  try {
    const text = JSON.stringify(value)
    return truncateForModel(text, maxChars)
  } catch {
    return truncateForModel(String(value), maxChars)
  }
}

export function summarizeUnknownForModel(value: unknown, maxChars = 1_800): unknown {
  if (value === null || value === undefined) return value
  if (typeof value === 'string') return truncateForModel(value, maxChars)
  if (typeof value === 'number' || typeof value === 'boolean') return value
  const json = truncateJsonForModel(value, maxChars)
  try {
    return JSON.parse(json)
  } catch {
    return json
  }
}

export type RunFlowModelStep = {
  nodeId: string
  nodeType?: string
  label?: string
  status: string
  durationMs?: number
  message?: string
  output?: unknown
  outputPreview?: string
}

export function compactRunFlowOutputForModel(output: {
  ok: boolean
  runId?: string
  flowId?: string
  entryNodeId?: string
  status?: string
  durationMs?: number
  error?: string
  availableNodeIds?: string[]
  filteredNodeIds?: string[]
  missingNodeIds?: string[]
  steps?: Array<{
    nodeId: string
    nodeType?: string
    label?: string
    status: string
    durationMs?: number
    message?: string
    output?: unknown
  }>
}): Record<string, unknown> {
  // Failed HTTP / bridge / run — keep it short for the model.
  if (!output.ok || output.status === 'failed') {
    const failedSteps =
      output.steps
        ?.filter((step) => step.status === 'error')
        .map((step) => ({
          nodeId: step.nodeId,
          label: step.label,
          nodeType: step.nodeType,
          message: step.message ? truncateForModel(step.message, 1_200) : undefined
        })) ?? []

    return {
      ok: false,
      status: output.status ?? 'failed',
      runId: output.runId,
      flowId: output.flowId,
      durationMs: output.durationMs,
      error: truncateForModel(output.error ?? 'run failed', 2_000),
      failedSteps,
      note: 'Full flow run failed. Fix the failing node(s), then call run_flow again (full run only).'
    }
  }

  let truncatedOutputs = 0
  const steps: RunFlowModelStep[] | undefined = output.steps?.map((step) => {
    const base: RunFlowModelStep = {
      nodeId: step.nodeId,
      nodeType: step.nodeType,
      label: step.label,
      status: step.status,
      durationMs: step.durationMs,
      message: step.message ? truncateForModel(step.message, 400) : undefined
    }
    if (step.output === undefined) return base

    const raw = truncateJsonForModel(step.output, 1_200)
    if (raw.includes('(truncated')) truncatedOutputs += 1
    try {
      base.output = JSON.parse(raw)
    } catch {
      base.outputPreview = raw
    }
    return base
  })

  return {
    ok: true,
    runId: output.runId,
    flowId: output.flowId,
    entryNodeId: output.entryNodeId,
    status: output.status,
    durationMs: output.durationMs,
    steps,
    ...(truncatedOutputs > 0
      ? {
          note: 'Some step outputs were truncated for context. Summarize for the user; do not re-run with partial node filters (unsupported).'
        }
      : {})
  }
}

export function compactCustomInfoOutputForModel(output: {
  ok: boolean
  error?: string
  titles?: string[]
  item?: { id: string; title: string; body: string; updatedAt: string }
  matches?: Array<{ id: string; title: string }>
}): Record<string, unknown> {
  if (!output.ok) {
    return { ok: false, error: output.error, titles: output.titles }
  }
  if (output.matches?.length) {
    return { ok: true, titles: output.titles, matches: output.matches }
  }
  if (!output.item) {
    return { ok: true, titles: output.titles ?? [] }
  }
  const body = output.item.body
  const truncated = body.length > 6_000
  return {
    ok: true,
    titles: output.titles,
    item: {
      id: output.item.id,
      title: output.item.title,
      updatedAt: output.item.updatedAt,
      body: truncated ? truncateForModel(body, 6_000) : body,
      ...(truncated
        ? { note: 'Custom info body was truncated for context; ask the user to paste a shorter excerpt if needed.' }
        : {})
    }
  }
}
