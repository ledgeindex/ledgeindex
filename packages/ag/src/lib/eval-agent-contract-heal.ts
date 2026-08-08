import type { Agent } from '@mastra/core/agent'
import { z } from 'zod'

export const agentContractRepairResultSchema = z.object({
  summary: z.string().min(1),
  agentMode: z.enum(['structured', 'text']),
  agentInstructions: z.string().min(1),
  /** JSON Schema object for structured mode; null/omit for text. */
  agentOutputSchema: z.record(z.string(), z.unknown()).nullable().optional(),
  /** Human/verify shape string, e.g. "matches: { title, price }[]" */
  outputShape: z.string().optional()
})

export type AgentContractRepairResult = z.infer<typeof agentContractRepairResultSchema>

export type AgentContractHealInput = {
  flowId: string
  nodeId: string
  runtimeError: string
  agentMode?: 'structured' | 'text'
  agentInstructions?: string
  agentOutputSchema?: Record<string, unknown>
  outputShape?: string
  phasePlan?: string
  inputSnapshot?: unknown
  observedOutput?: unknown
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

export function buildAgentContractHealPrompt(input: AgentContractHealInput): string {
  const lines = [
    `Fix agent-node contract for ${input.nodeId} (attempt ${input.attempt}).`,
    '',
    `Runtime / shape error:`,
    input.runtimeError,
    '',
    `Current agentMode: ${input.agentMode ?? 'unknown'}`,
    ''
  ]

  if (input.phasePlan?.trim()) {
    lines.push(`Phase plan: ${input.phasePlan.trim()}`, '')
  }
  if (input.agentInstructions?.trim()) {
    lines.push(`Current instructions:`, input.agentInstructions.trim(), '')
  }
  if (input.outputShape?.trim()) {
    lines.push(`Current outputShape: ${input.outputShape.trim()}`, '')
  }
  if (input.agentOutputSchema) {
    lines.push(`Current agentOutputSchema:`, truncateJson(input.agentOutputSchema), '')
  }
  if (input.inputSnapshot !== undefined) {
    lines.push(`Upstream $input (truncated):`, truncateJson(input.inputSnapshot), '')
  }
  if (input.observedOutput !== undefined) {
    lines.push(`Observed agent output (truncated):`, truncateJson(input.observedOutput), '')
  }
  if (input.userHint?.trim()) {
    lines.push(`User hint: ${input.userHint.trim()}`, '')
  }
  if (input.priorRepairSummaries?.length) {
    lines.push(
      'Prior repair attempts on this verify loop (do NOT repeat the same patch; try a different strategy or escalate):',
      ...input.priorRepairSummaries.map((s, i) => `${i + 1}. ${s}`),
      ''
    )
  }

  lines.push(
    'Emit a corrected agentMode, agentInstructions, agentOutputSchema (null if text), and outputShape.',
    'If observed output is empty/none, fix instructions so the model MUST return the envelope keys — schema-only tweaks will not help.'
  )
  return lines.join('\n')
}

export async function evalAgentContractHeal(
  agent: Agent,
  input: AgentContractHealInput
): Promise<AgentContractRepairResult & { nodeId: string }> {
  const response = await agent.generate(buildAgentContractHealPrompt(input), {
    structuredOutput: { schema: agentContractRepairResultSchema }
  })

  const raw = (response as { object?: unknown }).object
  const parsed = agentContractRepairResultSchema.parse(raw ?? {})

  if (parsed.agentMode === 'structured') {
    if (!parsed.agentOutputSchema || typeof parsed.agentOutputSchema !== 'object') {
      throw new Error('Structured agent contract heal missing agentOutputSchema')
    }
  }

  return {
    ...parsed,
    agentOutputSchema:
      parsed.agentMode === 'text' ? null : parsed.agentOutputSchema ?? null,
    nodeId: input.nodeId
  }
}
