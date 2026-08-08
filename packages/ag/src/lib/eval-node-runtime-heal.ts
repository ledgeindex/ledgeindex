import type { Agent } from '@mastra/core/agent'
import { RequestContext } from '@mastra/core/request-context'
import { readFileSync } from 'fs'
import { extractAgentFinalSummary } from './agent-final-summary'
import { flowPackageDir, nodeSourceFilePath, nodeSourceRelativePath } from './flow-package-paths'

const MAX_HEAL_ATTEMPTS = 2

export type RuntimeHealInput = {
  flowId: string
  nodeId: string
  runtimeError: string
  inputSnapshot?: unknown
  observedOutput?: unknown
  outputShape?: string
  phasePlan?: string
  userHint?: string
  attempt: number
  priorRepairSummaries?: string[]
}

function truncateJson(value: unknown, max = 2500): string {
  try {
    const text = JSON.stringify(value, null, 2)
    if (text.length <= max) return text
    return `${text.slice(0, max)}\n…(truncated)`
  } catch {
    return String(value).slice(0, max)
  }
}

export function buildRuntimeHealPrompt(input: RuntimeHealInput): string {
  const relativePath = nodeSourceRelativePath(input.nodeId)
  const lines = [
    `Fix runtime verify failure in ${relativePath} (attempt ${input.attempt}/${MAX_HEAL_ATTEMPTS}).`,
    '',
    `Runtime error / shape failure:`,
    input.runtimeError,
    ''
  ]

  if (input.phasePlan?.trim()) {
    lines.push(`Step plan: ${input.phasePlan.trim()}`, '')
  }
  if (input.outputShape?.trim()) {
    lines.push(`Declared outputShape: ${input.outputShape.trim()}`, '')
  }
  if (input.inputSnapshot !== undefined) {
    lines.push(`$input snapshot (truncated):`, truncateJson(input.inputSnapshot), '')
  }
  if (input.observedOutput !== undefined) {
    lines.push(`Observed output (truncated):`, truncateJson(input.observedOutput), '')
  }
  if (input.userHint?.trim()) {
    lines.push(`User hint (follow this): ${input.userHint.trim()}`, '')
  }
  if (input.priorRepairSummaries?.length) {
    lines.push(
      'Prior repair attempts on this verify loop (do NOT repeat failed patches; try a different fix):',
      ...input.priorRepairSummaries.map((s, i) => `${i + 1}. ${s}`),
      ''
    )
  }

  lines.push(
    'Instructions:',
    `- Read ${relativePath} with mastra_workspace_read_file`,
    '- Surgical mastra_workspace_edit_file fixes only',
    '- Keep export default async function main($input, $ctx)',
    '- Align keys with observed data / outputShape',
    '- After edits, write ONLY a short past-tense summary of what you changed (file + fields). No inspection plans.'
  )

  return lines.join('\n')
}

export type RuntimeHealResult = {
  ok: true
  nodeId: string
  sourceAfter: string
  summary: string
}

/**
 * Run flow-repair (or compatible heal) agent against a node after runtime verify failure.
 */
export async function evalNodeRuntimeHeal(
  agent: Agent,
  input: RuntimeHealInput
): Promise<RuntimeHealResult> {
  const flowPackagePath = flowPackageDir(input.flowId)
  const requestContext = new RequestContext([
    ['flowPackagePath', flowPackagePath],
    ['flow_id', input.flowId],
    ['nodeId', input.nodeId]
  ])

  const result = await agent.generate(buildRuntimeHealPrompt(input), {
    maxSteps: 12,
    requestContext
  })

  const sourceAfter = readFileSync(nodeSourceFilePath(input.flowId, input.nodeId), 'utf8')
  return {
    ok: true,
    nodeId: input.nodeId,
    sourceAfter,
    summary: extractAgentFinalSummary(result, `Repaired ${input.nodeId}`, 400)
  }
}

export { MAX_HEAL_ATTEMPTS as RUNTIME_HEAL_MAX_ATTEMPTS }
