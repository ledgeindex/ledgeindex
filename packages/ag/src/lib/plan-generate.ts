import { DEFAULT_CAPABILITY_CATALOG } from './builtin-catalog'
import {
  flowPlanSchema,
  flowPlanPlannerSchema,
  normalizePlanAgentModes,
  slugifyPlanTitle,
  type FlowPlan
} from './flow-plan'
import { planArchitectAgent } from '../mastra/agents/plan-architect'
import { planRevisionAgent } from '../mastra/agents/plan-revision-agent'
import {
  formatPlanningContextForPrompt,
  formatRevisionOverviewForPrompt,
  type PlanningContextBundle
} from './planning-context'
import {
  formatMountedContextForPrompt,
  type FlowBuildMountedContext
} from './planning-context/mounted-context'
import {
  buildPlanningRequestContext,
  type PlanningModelSelection
} from './planning-model'

export type GenerateFlowPlanInput = {
  prompt: string
  flowKind?: FlowPlan['flowKind']
  priorPlan?: FlowPlan
  revisionPrompt?: string
  planningContext?: PlanningContextBundle
  mountedContext?: FlowBuildMountedContext
  model?: PlanningModelSelection
}

function formatPlanError(err: unknown): string {
  if (err instanceof Error && err.message.trim()) return err.message.trim()
  return String(err)
}

function resolvePlanningContext(input: GenerateFlowPlanInput): PlanningContextBundle | undefined {
  return input.planningContext ?? input.priorPlan?.planningContext
}

function buildPlannerPrompt(input: GenerateFlowPlanInput, retryFeedback?: string): string {
  const catalogList = DEFAULT_CAPABILITY_CATALOG.entries
    .map((e) => `${e.id} (${e.label})`)
    .join('\n')

  const planningContext = resolvePlanningContext(input)

  const revisionBlock = input.priorPlan
    ? [
        '',
        formatRevisionOverviewForPrompt(input.priorPlan, planningContext),
        '',
        'Prior plan JSON (preserve ids/structure where still valid):',
        JSON.stringify(input.priorPlan, null, 2),
        '',
        `Revision request: ${input.revisionPrompt ?? 'Improve the plan.'}`
      ].join('\n')
    : ''

  const researchBlock =
    !input.priorPlan && planningContext
      ? `\n${formatPlanningContextForPrompt(planningContext)}\n`
      : ''

  const mountedBlock = input.mountedContext
    ? `\n${formatMountedContextForPrompt(input.mountedContext)}\n`
    : ''

  const retryBlock = retryFeedback
    ? `\n\nPrevious attempt failed schema validation:\n${retryFeedback}\nFix every listed field. Every phase MUST include non-empty strings for phase, title, spec, and plan. Agent phases MUST set agentMode ("structured" | "text") and agentInstructions; structured also needs agentOutputSchema; text must omit agentOutputSchema.\n`
    : ''

  return `User request:\n${input.prompt}
${input.flowKind ? `\nPreferred flowKind: ${input.flowKind}` : ''}
${revisionBlock}
${researchBlock}
${mountedBlock}
${retryBlock}
Available capabilities:
${catalogList}

Produce a complete FlowPlan. Use realistic phases for a local Electron automation (hotkeys, TypeScript code nodes, clipboard/notification sinks).
Write summary as a plain-language overview of the full automation before listing phases.
When the user names a keyboard shortcut, put it on the hotkey trigger phase/branch as chord (e.g. Ctrl+Shift+S).
When docs research / per-node implementation knowledge is provided, keep required packages and agent contracts aligned with that context.
When brain workspace or uploaded file context is provided, treat it as authoritative user background for the automation.`
}

async function attemptGenerateFlowPlan(
  input: GenerateFlowPlanInput,
  retryFeedback?: string
): Promise<FlowPlan> {
  const planner = input.priorPlan ? planRevisionAgent : planArchitectAgent
  const planningContext = resolvePlanningContext(input)

  const response = await planner.generate(buildPlannerPrompt(input, retryFeedback), {
    structuredOutput: { schema: flowPlanPlannerSchema },
    requestContext: buildPlanningRequestContext(input.model)
  })

  const raw = (response as { object?: unknown }).object
  const parsed = flowPlanPlannerSchema.parse(raw ?? {})
  const slug = parsed.slug?.trim() || slugifyPlanTitle(parsed.title)

  return normalizePlanAgentModes(
    flowPlanSchema.parse({
      ...parsed,
      slug,
      version: 1 as const,
      ...(planningContext ? { planningContext } : {})
    })
  )
}

export async function generateFlowPlanFromPrompt(
  input: GenerateFlowPlanInput
): Promise<FlowPlan> {
  try {
    return await attemptGenerateFlowPlan(input)
  } catch (firstErr) {
    // One automatic retry — models occasionally drop required phase.plan / agent fields.
    return await attemptGenerateFlowPlan(input, formatPlanError(firstErr))
  }
}
