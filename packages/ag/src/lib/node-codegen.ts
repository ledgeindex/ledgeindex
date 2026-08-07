import { z } from 'zod'
import type { Agent } from '@mastra/core/agent'
import type { RequestContext } from '@mastra/core/request-context'
import type { FlowPlan } from './flow-plan'
import type { NodeCodegenTask } from './node-codegen-templates'
import {
  formatCodegenImplContextForPrompt,
  selectCodegenImplContext
} from './planning-context/codegen-impl-context'
import {
  formatPinSchemasForCodegen,
  looksLikePinEmitStep,
  resolvePinTypesForPhase
} from './pin-schema-lookup'

/**
 * Full node file contents. Named `code` (not `source`) to avoid clashing with
 * Mastra/AI-SDK response fields that also use `source`.
 */
const nodeCodeSchema = z.object({
  code: z.string().min(1)
})

const MAX_CODEGEN_ATTEMPTS = 3

export type NodeCodegenResult = {
  source: string
  fromAgent: boolean
}

function isTrivialPassThrough(source: string): boolean {
  const normalized = source
    .replace(/\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, '')
  return /^exportdefaultasyncfunctionmain\(\$input(?:,\$ctx)?\)\{return(?:\$input(?:\?\?\{\})?|\{\})\}$/.test(
    normalized
  )
}

export function validateNodeSource(
  source: string,
  task?: Pick<NodeCodegenTask, 'nodeId' | 'spec'>
): { ok: true } | { ok: false; reason: string } {
  const s = source.trim()
  if (!s.includes('export default')) {
    return { ok: false, reason: 'missing export default' }
  }
  if (!/export\s+default\s+async\s+function\s+main\s*\(/.test(s)) {
    return { ok: false, reason: 'must export default async function main($input, $ctx)' }
  }
  if (s.length < 40) {
    return { ok: false, reason: 'source too short' }
  }

  const isMergeNode =
    task?.nodeId.startsWith('merge-') || task?.spec.toLowerCase().startsWith('merge.')
  if (!isMergeNode && isTrivialPassThrough(s)) {
    return { ok: false, reason: 'must implement the step behavior — not only return $input' }
  }

  return { ok: true }
}

function pinSchemaBlockForTask(task: NodeCodegenTask): string {
  const pinTypes = resolvePinTypesForPhase({
    spec: task.spec,
    plan: task.phase.plan
  })
  if (pinTypes.length === 0 && !looksLikePinEmitStep({ spec: task.spec, plan: task.phase.plan })) {
    return ''
  }
  const types =
    pinTypes.length > 0
      ? pinTypes
      : resolvePinTypesForPhase({
          spec: task.spec,
          plan: `${task.phase.plan} ${task.label} ${task.spec}`
        })
  if (types.length === 0) {
    return [
      '',
      '## Pin artifacts',
      'This step appears to emit Cards pin artifacts. Return an array of',
      '{ pinType, title?, pin_config } using only AutomationGhost pin types',
      '(markdown, table, plan, list, json-list, checklist, stat-cards, key-value, charts, mermaid, json-viewer).',
      'Prefer naming types explicitly in the plan/spec next time (e.g. step.emit_pins.markdown+table).'
    ].join('\n')
  }
  return `\n\n${formatPinSchemasForCodegen(types)}`
}

export function buildCodegenPrompt(task: NodeCodegenTask, plan: FlowPlan, failure?: string): string {
  const retry = failure
    ? `\n\nPrevious attempt failed validation:\n${failure}\nFix these issues in code.`
    : ''
  const pinBlock = pinSchemaBlockForTask(task)
  const implCtx = selectCodegenImplContext(task.phase, plan)
  const implBlock = formatCodegenImplContextForPrompt(implCtx)
  const hasRequiredDeps = implCtx.dependencies.length > 0

  return `Generate TypeScript for nodes/${task.nodeId}.ts.

Flow: ${plan.title}
Summary: ${plan.summary}
Step: ${task.label}
Spec: ${task.spec}
Behavior: ${task.phase.plan}
${implBlock}${pinBlock}

Put the complete file contents in the structured field "code".
Requirements for code:
- export default async function main($input, $ctx)
- $input: upstream output (unknown shape)
- $ctx: { runId, flowId, trigger, nodes, connectors } — connectors.clipboard.text is the system clipboard at run time
- Implement the behavior above — do NOT only return $input unchanged unless the step is a merge/pass-through
- Return JSON-serializable data only
${
  hasRequiredDeps
    ? '- Required packages listed above are authoritative — import and use them (do not swap for fetch/cheerio stubs)'
    : '- Prefer libraries named in the step/plan; if none are named, use fetch + cheerio or a minimal implementation that still meets the behavior contract'
}
- Honor declared outputShape keys when provided
- code must be raw TypeScript only (no markdown fences)${retry}`
}

function readStructuredCode(response: unknown): string {
  const object = (response as { object?: unknown }).object
  if (!object || typeof object !== 'object') return ''
  const record = object as Record<string, unknown>
  // Prefer `code`; accept legacy `source` if an older schema somehow responds.
  for (const key of ['code', 'source'] as const) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

/**
 * One path: codegen agent + structuredOutput `{ code }`.
 * Heal (workspace tools) stays in node-eval via node-builder.
 */
export async function generateNodeSourceWithAgent(
  agent: Agent,
  task: NodeCodegenTask,
  plan: FlowPlan,
  requestContext?: RequestContext
): Promise<NodeCodegenResult> {
  let lastFailure = 'no valid output'

  for (let attempt = 1; attempt <= MAX_CODEGEN_ATTEMPTS; attempt++) {
    const prompt = buildCodegenPrompt(task, plan, attempt === 1 ? undefined : lastFailure)
    console.log(`[codegen] Attempt ${attempt}/${MAX_CODEGEN_ATTEMPTS} for nodes/${task.nodeId}.ts`)

    try {
      const response = await agent.generate(prompt, {
        maxSteps: 1,
        requestContext,
        structuredOutput: {
          schema: nodeCodeSchema,
          jsonPromptInjection: 'inline'
        }
      } as never)

      const code = readStructuredCode(response)
      if (!code) {
        const object = (response as { object?: unknown }).object
        const keys =
          object && typeof object === 'object'
            ? Object.keys(object as Record<string, unknown>).join(',')
            : String(object)
        const textPreview = String((response as { text?: string }).text ?? '')
          .slice(0, 160)
          .replace(/\s+/g, ' ')
        lastFailure = `structured output missing code field (object keys=${keys || 'none'}; text=${textPreview || 'empty'})`
        console.warn(`[codegen] Attempt ${attempt} failed for ${task.nodeId}: ${lastFailure}`)
        continue
      }

      const validation = validateNodeSource(code, task)
      if (!validation.ok) {
        lastFailure = validation.reason
        console.warn(`[codegen] Attempt ${attempt} failed for ${task.nodeId}: ${lastFailure}`)
        continue
      }

      console.log(`[codegen] Agent wrote nodes/${task.nodeId}.ts (${code.length} chars)`)
      return { source: code, fromAgent: true }
    } catch (error) {
      lastFailure = error instanceof Error ? error.message : String(error)
      console.warn(`[codegen] Attempt ${attempt} failed for ${task.nodeId}: ${lastFailure}`)
    }
  }

  throw new Error(
    `Codegen failed for ${task.nodeId} (${task.label}) after ${MAX_CODEGEN_ATTEMPTS} attempts: ${lastFailure}`
  )
}
