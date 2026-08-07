import type { Agent } from '@mastra/core/agent'
import { z } from 'zod'
import {
  controlIfDataSchema,
  truncateControlIfDescription,
  type ControlIfData
} from './flow-control'
import type { PlanPhase } from './flow-plan'
import {
  inferReturnShapeFromSource,
  pickFieldForShape,
  type InferredOutputShape
} from './infer-node-output-shape'
import { controlIfBuilderAgent } from '../mastra/agents/control-if-builder'

const controlIfConfigSchema = controlIfDataSchema.pick({
  field: true,
  operator: true,
  compareValue: true,
  label: true
})

export type ConfigureControlIfInput = {
  ifPhase: PlanPhase
  label: string
  upstreamNodeId: string
  upstreamLabel: string
  upstreamSource: string
  agent?: Agent
}

function branchDescriptions(phase: PlanPhase): Pick<ControlIfData, 'thenDescription' | 'elseDescription'> {
  const trueBranch = phase.branches?.find((branch) => branch.id === 'true')
  const falseBranch = phase.branches?.find((branch) => branch.id === 'false')
  return {
    thenDescription: truncateControlIfDescription(trueBranch?.plan || trueBranch?.title),
    elseDescription: truncateControlIfDescription(falseBranch?.plan || falseBranch?.title)
  }
}

function inferOperatorFromPlan(planText: string): ControlIfData['operator'] {
  const text = planText.toLowerCase()
  if (text.includes('empty') || text.includes('falsy') || text.includes('no ')) return 'falsy'
  if (text.includes('equals') || text.includes('is ')) return 'equals'
  if (text.includes('greater') || text.includes('>')) return 'gt'
  if (text.includes('less') || text.includes('<')) return 'lt'
  if (text.includes('contains') || text.includes('includes')) return 'contains'
  return 'contains'
}

function inferCompareValue(planText: string, operator: ControlIfData['operator']): string | undefined {
  if (operator === 'truthy' || operator === 'falsy') return undefined
  const quoted = planText.match(/["']([^"']{1,48})["']/)
  if (quoted?.[1]) return quoted[1]
  if (operator === 'contains') {
    const containsWord = planText.match(/\bcontains\s+["']?([a-z0-9_-]{2,32})["']?/i)
    if (containsWord?.[1]) return containsWord[1]
  }
  const urgent = planText.match(/\burgent\b/i)
  if (urgent && operator === 'contains') return 'urgent'
  if (operator === 'equals') {
    const m = planText.match(/\bis\s+([a-z0-9_-]{2,32})\b/i)
    return m?.[1]
  }
  return undefined
}

export function configureControlIfDeterministic(input: ConfigureControlIfInput): ControlIfData {
  const shape = inferReturnShapeFromSource(input.upstreamSource)
  const planText = `${input.ifPhase.plan} ${input.ifPhase.title}`
  const operator = inferOperatorFromPlan(planText)
  const field = pickFieldForShape(shape.keys)

  return controlIfDataSchema.parse({
    label: input.label,
    field,
    operator,
    compareValue: inferCompareValue(planText, operator),
    ...branchDescriptions(input.ifPhase),
    configuredFromUpstream: input.upstreamNodeId,
    inferredOutputKeys: shape.keys
  })
}

function buildAgentPrompt(
  input: ConfigureControlIfInput,
  shape: InferredOutputShape
): string {
  return `Configure control.if for "${input.label}".

Upstream node: ${input.upstreamNodeId} (${input.upstreamLabel})
Inferred return keys: ${shape.keys.length > 0 ? shape.keys.join(', ') : '(none detected)'}
Return literals: ${shape.returnLiterals.join(' | ') || '(none)'}

Upstream source:
\`\`\`typescript
${input.upstreamSource}
\`\`\`

IF phase plan: ${input.ifPhase.plan}
IF phase title: ${input.ifPhase.title}
Then branch: ${input.ifPhase.branches?.find((b) => b.id === 'true')?.plan ?? 'n/a'}
Else branch: ${input.ifPhase.branches?.find((b) => b.id === 'false')?.plan ?? 'n/a'}`
}

export async function configureControlIfFromBuild(
  input: ConfigureControlIfInput
): Promise<ControlIfData> {
  const shape = inferReturnShapeFromSource(input.upstreamSource)
  const agent = input.agent ?? controlIfBuilderAgent
  const branches = branchDescriptions(input.ifPhase)

  try {
    const response = await agent.generate(buildAgentPrompt(input, shape), {
      structuredOutput: { schema: controlIfConfigSchema }
    })
    const raw = (response as { object?: unknown }).object
    const parsed = controlIfConfigSchema.parse(raw ?? {})

    const field =
      shape.keys.length > 0 && parsed.field && !shape.keys.includes(parsed.field.split('.')[0] ?? '')
        ? pickFieldForShape(shape.keys)
        : parsed.field || pickFieldForShape(shape.keys)

    return controlIfDataSchema.parse({
      ...parsed,
      field,
      ...branches,
      configuredFromUpstream: input.upstreamNodeId,
      inferredOutputKeys: shape.keys
    })
  } catch {
    return configureControlIfDeterministic(input)
  }
}

export function upstreamSourcesForNode(
  nodeId: string,
  edges: Array<{ source: string; target: string }>
): string[] {
  return edges.filter((edge) => edge.target === nodeId).map((edge) => edge.source)
}
