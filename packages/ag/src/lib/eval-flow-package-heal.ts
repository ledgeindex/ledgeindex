import type { Agent } from '@mastra/core/agent'
import { RequestContext } from '@mastra/core/request-context'
import { extractAgentFinalSummary } from './agent-final-summary'
import { flowPackageDir } from './flow-package-paths'

export type FlowPackageHealInput = {
  flowId: string
  attempt: number
  maxAttempts: number
  analysisHint?: string
  failedSteps?: Array<{ nodeId: string; label?: string; message: string }>
  shapeFailures?: Array<{ nodeId: string; message: string }>
  priorRepairSummaries?: string[]
  phaseNotes?: Array<{ nodeId: string; plan?: string; outputShape?: string }>
  /** Truncated observed outputs from the last dry-run. */
  stepSamples?: Array<{
    nodeId: string
    status?: string
    message?: string
    output?: unknown
  }>
}

function truncate(text: string, max = 400): string {
  const t = text.trim()
  return t.length <= max ? t : `${t.slice(0, max)}…`
}

function truncateJson(value: unknown, max = 1600): string {
  try {
    const text = JSON.stringify(value, null, 2)
    return text.length <= max ? text : `${text.slice(0, max)}\n…(truncated)`
  } catch {
    return String(value).slice(0, max)
  }
}

export function buildFlowPackageHealPrompt(input: FlowPackageHealInput): string {
  const lines = [
    `Whole-flow package heal attempt ${input.attempt}/${input.maxAttempts}.`,
    'Per-node auto-repair already stalled — fix whatever is needed across the package.',
    ''
  ]

  if (input.analysisHint?.trim()) {
    lines.push('Analysis brief (follow this):', truncate(input.analysisHint, 1200), '')
  }

  if (input.failedSteps?.length) {
    lines.push('Failed steps:')
    for (const s of input.failedSteps) {
      lines.push(
        `- ${s.nodeId}${s.label ? ` (${s.label})` : ''}: ${truncate(s.message, 320)}`
      )
    }
    lines.push('')
  }

  if (input.shapeFailures?.length) {
    lines.push('Shape failures:')
    for (const f of input.shapeFailures) {
      lines.push(`- ${f.nodeId}: ${truncate(f.message, 320)}`)
    }
    lines.push('')
  }

  if (input.priorRepairSummaries?.length) {
    lines.push('Prior per-node repairs (do not repeat the same patches):')
    for (const [i, s] of input.priorRepairSummaries.entries()) {
      lines.push(`${i + 1}. ${truncate(s, 280)}`)
    }
    lines.push('')
  }

  if (input.phaseNotes?.length) {
    lines.push('Phase notes:')
    for (const p of input.phaseNotes) {
      lines.push(
        `- ${p.nodeId}: shape=${p.outputShape ?? 'n/a'}; plan=${truncate(p.plan ?? '', 200)}`
      )
    }
    lines.push('')
  }

  if (input.stepSamples?.length) {
    lines.push('Observed dry-run outputs (truncated) — also available via read_verify_samples:')
    for (const s of input.stepSamples.slice(0, 8)) {
      lines.push(`--- ${s.nodeId} (${s.status ?? '?'}) ---`)
      if (s.message) lines.push(`message: ${truncate(s.message, 240)}`)
      if (s.output !== undefined) lines.push(truncateJson(s.output))
    }
    lines.push('')
  }

  lines.push(
    'Instructions:',
    '1. Call read_verify_samples to list/read last dry-run outputs for failing + upstream nodes',
    '2. Read flow.json and related nodes/{id}.ts',
    '3. Patch code and/or agent contracts so the next host dry-run + shapes pass',
    '4. Final reply ONLY: short past-tense summary of what you changed (no "I will inspect" plans)'
  )

  return lines.join('\n')
}

export type FlowPackageHealResult = {
  ok: true
  summary: string
}

export async function evalFlowPackageHeal(
  agent: Agent,
  input: FlowPackageHealInput
): Promise<FlowPackageHealResult> {
  const flowPackagePath = flowPackageDir(input.flowId)
  const requestContext = new RequestContext([
    ['flowPackagePath', flowPackagePath],
    ['flow_id', input.flowId]
  ])

  const result = await agent.generate(buildFlowPackageHealPrompt(input), {
    maxSteps: 20,
    requestContext
  })

  return {
    ok: true,
    summary: extractAgentFinalSummary(
      result,
      `Package heal attempt ${input.attempt}`,
      500
    )
  }
}
