import type { FlowPlan, PlanPhase } from '../flow-plan'
import {
  formatCodegenImplContextForPrompt,
  selectCodegenImplContext
} from './codegen-impl-context'
import { formatPlanningContextForPrompt } from './format-for-prompt'
import type { PlanningContextBundle } from './types'

function truncate(text: string, max: number): string {
  const t = text.trim()
  return t.length <= max ? t : `${t.slice(0, max)}…`
}

function formatAgentContract(phase: PlanPhase): string[] {
  const lines: string[] = []
  if (!phase.spec.trim().toLowerCase().startsWith('agent.')) return lines
  if (phase.agentMode) lines.push(`  agentMode: ${phase.agentMode}`)
  if (phase.agentInstructions?.trim()) {
    lines.push(`  agentInstructions: ${truncate(phase.agentInstructions, 700)}`)
  }
  if (phase.agentOutputSchema && typeof phase.agentOutputSchema === 'object') {
    lines.push(
      `  agentOutputSchema: ${truncate(JSON.stringify(phase.agentOutputSchema), 900)}`
    )
  }
  return lines
}

function formatPhaseBlock(phase: PlanPhase, plan: FlowPlan): string {
  const nodeId = `phase-${phase.phase}`
  const lines = [
    `### ${nodeId} — ${phase.title}`,
    `spec: ${phase.spec}`,
    `plan: ${phase.plan}`,
  ]
  if (phase.outputShape?.trim()) lines.push(`outputShape: ${phase.outputShape.trim()}`)
  if (phase.dependencies?.length) {
    lines.push(`dependencies: ${phase.dependencies.join(', ')}`)
  }
  if (phase.chord?.trim()) lines.push(`chord: ${phase.chord.trim()}`)
  lines.push(...formatAgentContract(phase))

  if (phase.branches?.length) {
    lines.push('branches:')
    for (const branch of phase.branches) {
      lines.push(`  - [${branch.id}] ${branch.title} (${branch.spec}): ${branch.plan}`)
      if (branch.dependencies?.length) {
        lines.push(`    dependencies: ${branch.dependencies.join(', ')}`)
      }
      if (branch.steps?.length) {
        for (const [i, step] of branch.steps.entries()) {
          lines.push(
            `    step ${i + 1}: ${step.title} (${step.spec}) — ${step.plan}`
          )
          if (step.dependencies?.length) {
            lines.push(`      dependencies: ${step.dependencies.join(', ')}`)
          }
        }
      }
    }
  }

  // Plan used for research selection must include planningContext on the root.
  const planForSelect: FlowPlan = plan.planningContext
    ? plan
    : plan
  const impl = selectCodegenImplContext(phase, planForSelect)
  const implBlock = formatCodegenImplContextForPrompt(impl).trim()
  if (implBlock) {
    lines.push('Node-relevant implementation knowledge:')
    for (const line of implBlock.split('\n')) {
      lines.push(line ? `  ${line}` : '')
    }
  }

  return lines.join('\n')
}

/**
 * Full overview for the revision agent: flow summary + per-node contracts
 * (including agent schema) + per-node matched web-research knowledge.
 */
export function formatRevisionOverviewForPrompt(
  plan: FlowPlan,
  planningContext?: PlanningContextBundle
): string {
  const ctx = planningContext ?? plan.planningContext
  const planWithCtx: FlowPlan = ctx ? { ...plan, planningContext: ctx } : plan

  const lines: string[] = [
    '## Live flow overview (authoritative for revision)',
    `title: ${plan.title}`,
    `slug: ${plan.slug}`,
    `flowKind: ${plan.flowKind}`,
    `summary: ${plan.summary}`,
  ]

  if (plan.connectorsNeeded?.length) {
    lines.push(`connectorsNeeded: ${plan.connectorsNeeded.join(', ')}`)
  }
  const suggested = plan.suggestedDependencies ?? plan.feasibility?.packages.suggested
  if (suggested && Object.keys(suggested).length) {
    lines.push(
      `suggestedDependencies: ${Object.entries(suggested)
        .map(([k, v]) => `${k}@${v}`)
        .join(', ')}`
    )
  }

  lines.push('', '## Per-node plan / contracts')
  for (const phase of plan.phases) {
    lines.push('', formatPhaseBlock(phase, planWithCtx))
  }

  if (ctx) {
    lines.push('', '## Global docs research (also filtered per node above)')
    lines.push(formatPlanningContextForPrompt(ctx))
  }

  return lines.join('\n')
}
