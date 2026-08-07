import type { FlowPlan, PlanPhase } from './flow-plan'
import { branchArmSteps, branchStepNodeId } from './flow-plan'

export type NodeCodegenTask = {
  nodeId: string
  label: string
  spec: string
  phase: PlanPhase
}

function phaseForNode(plan: FlowPlan, nodeId: string): PlanPhase | undefined {
  for (const phase of plan.phases) {
    if (`phase-${phase.phase}` === nodeId) return phase
    for (const branch of phase.branches ?? []) {
      const armSteps = branchArmSteps(branch)
      for (let i = 0; i < armSteps.length; i++) {
        const stepId = branchStepNodeId(phase.phase, branch.id, i, armSteps.length)
        if (stepId !== nodeId) continue
        const step = armSteps[i]
        return { ...phase, title: step.title, spec: step.spec, plan: step.plan }
      }
    }
    if (`merge-${phase.phase}` === nodeId) return phase
  }
  return undefined
}

export function buildCodegenTasks(plan: FlowPlan, codeNodeIds: string[]): NodeCodegenTask[] {
  return codeNodeIds
    .map((nodeId) => {
      const phase = phaseForNode(plan, nodeId)
      if (!phase) return null
      return {
        nodeId,
        label: phase.title,
        spec: phase.spec,
        phase
      }
    })
    .filter((task): task is NodeCodegenTask => task !== null)
}

export function templateNodeSource(task: NodeCodegenTask, plan: FlowPlan): string {
  const spec = task.spec.toLowerCase()
  const goal = plan.summary.replace(/'/g, "\\'")

  if (spec.includes('fetch') || spec.includes('weather') || spec.includes('api') || spec.includes('http')) {
    return `export default async function main($input, $ctx) {
  // ${task.label} — ${task.phase.plan}
  const response = await fetch('https://api.example.com/data')
  if (!response.ok) {
    throw new Error(\`Request failed: \${response.status}\`)
  }
  const data = await response.json()
  return { ...($input ?? {}), data, goal: '${goal}' }
}
`
  }

  if (spec.includes('format') || spec.includes('parse') || spec.includes('pipeline') || spec.includes('transform')) {
    return `export default async function main($input, $ctx) {
  // ${task.label} — ${task.phase.plan}
  const payload = $input ?? {}
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2)
  return { text, summary: text.slice(0, 500) }
}
`
  }

  if (spec.includes('clipboard') || spec.includes('read_clipboard')) {
    return `export default async function main($input, $ctx) {
  // ${task.label} — ${task.phase.plan}
  const text = $ctx.connectors?.clipboard?.text ?? ''
  if (!text.trim()) {
    throw new Error('Clipboard is empty or unavailable')
  }
  return { ...(typeof $input === 'object' && $input !== null ? $input : {}), text }
}
`
  }

  if (spec.startsWith('merge.') || task.nodeId.startsWith('merge-')) {
    return `export default async function main($input, $ctx) {
  return $input ?? {}
}
`
  }

  const planText = `${task.phase.plan} ${task.spec} ${plan.summary}`.toLowerCase()
  if (planText.includes('log') || planText.includes('hello')) {
    return `export default async function main($input, $ctx) {
  const message = 'hello world'
  console.log(message)
  const base = typeof $input === 'object' && $input !== null ? $input : {}
  return { ...base, message }
}
`
  }

  return `export default async function main($input, $ctx) {
  // ${task.label} — ${task.phase.plan}
  // Automation: ${plan.title}
  return $input ?? {}
}
`
}
