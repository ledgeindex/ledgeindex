import type { Agent } from '@mastra/core/agent'
import { z } from 'zod'

export const verifyAnalyzeResultSchema = z.object({
  summary: z.string().min(1),
  rootCause: z.string().min(1),
  repairHint: z.string().min(1),
  strategy: z.enum([
    'runtime_heal',
    'agent_contract_heal',
    'accept_as_valid',
    'plan_revision'
  ]),
  focusNodeIds: z.array(z.string()).max(3).optional()
})

export type VerifyAnalyzeResult = z.infer<typeof verifyAnalyzeResultSchema>

export type VerifyAnalyzeInput = {
  failedSteps: Array<{
    nodeId: string
    label?: string
    message: string
    nodeType?: string
  }>
  shapeFailures?: Array<{ nodeId: string; message: string }>
  priorRepairSummaries?: string[]
  stepSamples?: Array<{
    nodeId: string
    output?: unknown
    message?: string
    status?: string
  }>
  phaseNotes?: Array<{ nodeId: string; plan?: string; outputShape?: string }>
}

function truncateJson(value: unknown, max = 1800): string {
  try {
    const text = JSON.stringify(value, null, 2)
    if (text.length <= max) return text
    return `${text.slice(0, max)}\n…(truncated)`
  } catch {
    return String(value).slice(0, max)
  }
}

/** Deterministic shortcuts — no LLM when the failure pattern is obvious. */
export function tryDeterministicVerifyAnalyze(
  input: VerifyAnalyzeInput
): VerifyAnalyzeResult | null {
  const shapes = input.shapeFailures ?? []
  const emptyItemKeyFail = shapes.find((f) =>
    /Missing keys \[.+\] for outputShape ".+:.+\[\]/i.test(f.message) &&
    /observed: none/i.test(f.message)
  )
  if (emptyItemKeyFail) {
    const nodeId = emptyItemKeyFail.nodeId
    return {
      summary: `Empty array under envelope on ${nodeId} is likely valid — stop schema churn.`,
      rootCause:
        'Shape assert treated an empty filtered list as missing item keys. Empty arrays under the envelope key are usually valid for filter/search steps.',
      repairHint: `Treat empty arrays under the declared envelope on ${nodeId} as success. Do not rewrite JSON schema again. If a downstream node fails, make it handle an empty upstream list (emit empty pins/table or a zero-count summary).`,
      strategy: 'accept_as_valid',
      focusNodeIds: [nodeId]
    }
  }

  const schemaChurn =
    (input.priorRepairSummaries?.filter((s) => /schema|JSON Schema|filteredJobs|outputSchema/i.test(s))
      .length ?? 0) >= 3
  if (schemaChurn && shapes[0]) {
    return {
      summary: 'Prior heals only rewrote schemas — switch strategy.',
      rootCause:
        'Repeated agent-contract schema patches did not change runtime output. Need envelope/instructions or downstream empty handling, not another schema.',
      repairHint: `Do not redefine JSON schema again. Ensure ${shapes[0].nodeId} always returns the envelope object (even when empty). Fix downstream nodes to accept empty upstream arrays.`,
      strategy: 'agent_contract_heal',
      focusNodeIds: [shapes[0].nodeId]
    }
  }

  return null
}

export function buildVerifyAnalyzePrompt(input: VerifyAnalyzeInput): string {
  const lines = [
    'Analyze this AutomationGhost verify failure and produce a repair plan.',
    '',
    'Failed steps:'
  ]
  for (const step of input.failedSteps) {
    lines.push(
      `- ${step.nodeId}${step.label ? ` (${step.label})` : ''}${step.nodeType ? ` [${step.nodeType}]` : ''}: ${step.message}`
    )
  }
  if (input.shapeFailures?.length) {
    lines.push('', 'Shape failures:')
    for (const f of input.shapeFailures) {
      lines.push(`- ${f.nodeId}: ${f.message}`)
    }
  }
  if (input.priorRepairSummaries?.length) {
    lines.push('', 'Prior repair attempts:')
    for (const [i, s] of input.priorRepairSummaries.entries()) {
      lines.push(`${i + 1}. ${s}`)
    }
  }
  if (input.phaseNotes?.length) {
    lines.push('', 'Phase notes:')
    for (const p of input.phaseNotes) {
      lines.push(
        `- ${p.nodeId}: shape=${p.outputShape ?? 'n/a'}; plan=${(p.plan ?? '').slice(0, 240)}`
      )
    }
  }
  if (input.stepSamples?.length) {
    lines.push('', 'Observed outputs (truncated):')
    for (const s of input.stepSamples.slice(0, 6)) {
      lines.push(`--- ${s.nodeId} (${s.status ?? '?'}) ---`)
      if (s.message) lines.push(`message: ${s.message}`)
      if (s.output !== undefined) lines.push(truncateJson(s.output))
    }
  }
  lines.push('', 'Return structured analysis only.')
  return lines.join('\n')
}

export async function evalVerifyAnalyze(
  agent: Agent,
  input: VerifyAnalyzeInput
): Promise<VerifyAnalyzeResult> {
  const deterministic = tryDeterministicVerifyAnalyze(input)
  if (deterministic) return deterministic

  const response = await agent.generate(buildVerifyAnalyzePrompt(input), {
    structuredOutput: { schema: verifyAnalyzeResultSchema }
  })
  const raw = (response as { object?: unknown }).object
  return verifyAnalyzeResultSchema.parse(raw ?? {})
}
