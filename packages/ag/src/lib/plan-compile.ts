import type { CompiledFlowPreview, FlowPlan, PlanPhase } from './flow-plan'
import { branchArmSteps, branchStepNodeId } from './flow-plan'
import { isExclusiveBranchSpec, isSwitchBranchSpec } from './flow-control'

function branchTagForManualBranch(branch: { title: string; spec: string }): string {
  const fromSpec = tagForSpec(branch.spec)
  if (fromSpec !== 'STEP') return fromSpec
  const word = branch.title.split(/\s+/)[0] ?? branch.title
  return word.toUpperCase()
}

function kindForSpec(spec: string): string {
  if (spec === 'trigger.schedule') return 'trigger'
  if (spec.startsWith('trigger.')) return 'manual'
  if (spec.startsWith('agent.')) return 'agent'
  if (spec.startsWith('tool.')) return 'tool'
  if (spec.startsWith('action.') || spec.startsWith('sink.')) return 'action'
  if (spec === 'pin' || spec.startsWith('pin.')) return 'step'
  if (isExclusiveBranchSpec(spec)) return 'branch'
  if (spec.startsWith('merge.')) return 'merge'
  return 'step'
}

function tagForSpec(spec: string): string {
  if (spec === 'trigger.manual') return 'MANUAL'
  if (spec === 'trigger.hotkey') return 'HOTKEY'
  if (spec === 'trigger.schedule') return 'SCHEDULE'
  if (spec === 'trigger.palette') return 'PALETTE'
  if (spec.startsWith('trigger.')) return 'TRIGGER'
  if (spec.startsWith('agent.')) return 'AGENT'
  if (spec.startsWith('tool.')) return 'TOOL'
  if (spec.startsWith('action.') || spec.startsWith('sink.')) return 'DELIVER'
  if (spec.startsWith('prompt.')) return 'PROMPT'
  if (spec === 'pin' || spec.startsWith('pin.')) return 'PIN'
  if (isSwitchBranchSpec(spec)) return 'SWITCH'
  if (spec.startsWith('control.if') || spec.startsWith('if ')) return 'IF'
  if (spec.startsWith('switch') || spec.startsWith('route.')) return 'BRANCH'
  if (spec.startsWith('merge.')) return 'MERGE'
  if (spec.startsWith('pipeline.')) return 'EXECUTE'
  return 'STEP'
}

function nodeIdForPhase(phase: PlanPhase, branchId?: string): string {
  return branchId ? `phase-${phase.phase}-${branchId}` : `phase-${phase.phase}`
}

function addPhaseNodes(
  phase: PlanPhase,
  nodes: CompiledFlowPreview['nodes'],
  edges: CompiledFlowPreview['edges'],
  previousIds: string[]
): string[] {
  const isManualTriggerWithBranches =
    phase.spec === 'trigger.manual' && (phase.branches?.length ?? 0) > 0

  if (isManualTriggerWithBranches) {
    const branchIds: string[] = []
    for (const branch of phase.branches ?? []) {
      const id = nodeIdForPhase(phase, branch.id)
      branchIds.push(id)
      nodes.push({
        id,
        label: branch.title,
        tag: branchTagForManualBranch(branch),
        kind: 'manual'
      })
      for (const prev of previousIds) {
        edges.push({ id: `${prev}->${id}`, source: prev, target: id, dashed: true })
      }
    }

    const mergeId = `merge-${phase.phase}`
    nodes.push({ id: mergeId, label: 'Merge triggers', tag: 'MERGE', kind: 'merge' })
    for (const branchId of branchIds) {
      edges.push({ id: `${branchId}->${mergeId}`, source: branchId, target: mergeId })
    }
    return [mergeId]
  }

  if ((phase.branches?.length ?? 0) > 0 && phase.spec.startsWith('agent.')) {
    const hubId = nodeIdForPhase(phase)
    nodes.push({
      id: hubId,
      label: phase.title,
      tag: tagForSpec(phase.spec),
      kind: kindForSpec(phase.spec)
    })
    for (const prev of previousIds) {
      edges.push({ id: `${prev}->${hubId}`, source: prev, target: hubId })
    }

    for (const branch of phase.branches ?? []) {
      const toolId = nodeIdForPhase(phase, branch.id)
      nodes.push({
        id: toolId,
        label: branch.title,
        tag: 'TOOL',
        kind: 'tool'
      })
      edges.push({
        id: `${hubId}->${toolId}`,
        source: hubId,
        target: toolId,
        dashed: true
      })
    }

    return [hubId]
  }

  if ((phase.branches?.length ?? 0) > 0) {
    const branchId = nodeIdForPhase(phase)
    nodes.push({
      id: branchId,
      label: phase.title,
      tag: tagForSpec(phase.spec),
      kind: 'branch'
    })
    for (const prev of previousIds) {
      edges.push({ id: `${prev}->${branchId}`, source: prev, target: branchId })
    }

    const leafIds: string[] = []
    const exclusive = isExclusiveBranchSpec(phase.spec)
    for (const branch of phase.branches ?? []) {
      const armSteps = branchArmSteps(branch)
      let chainPrev = branchId
      let lastId = ''

      armSteps.forEach((step, stepIndex) => {
        const stepId = branchStepNodeId(phase.phase, branch.id, stepIndex, armSteps.length)
        lastId = stepId
        nodes.push({
          id: stepId,
          label: step.title,
          tag: armSteps.length === 1 && exclusive ? 'ROUTE' : tagForSpec(step.spec),
          kind: kindForSpec(step.spec)
        })

        if (stepIndex === 0) {
          edges.push({
            id: `${branchId}->${stepId}`,
            source: branchId,
            target: stepId,
            dashed: true,
            ...(exclusive ? { sourceHandle: branch.id } : {})
          })
        } else {
          edges.push({
            id: `${chainPrev}->${stepId}`,
            source: chainPrev,
            target: stepId
          })
        }
        chainPrev = stepId
      })

      leafIds.push(lastId)
    }
    return leafIds
  }

  const id = nodeIdForPhase(phase)
  nodes.push({
    id,
    label: phase.title,
    tag: tagForSpec(phase.spec),
    kind: kindForSpec(phase.spec)
  })
  for (const prev of previousIds) {
    edges.push({ id: `${prev}->${id}`, source: prev, target: id })
  }
  return [id]
}

export function compilePlanPreview(plan: FlowPlan): CompiledFlowPreview {
  const nodes: CompiledFlowPreview['nodes'] = []
  const edges: CompiledFlowPreview['edges'] = []
  let previousIds: string[] = []

  for (const phase of plan.phases) {
    previousIds = addPhaseNodes(phase, nodes, edges, previousIds)
  }

  return {
    nodeCount: nodes.length,
    edgeCount: edges.length,
    nodes,
    edges
  }
}
