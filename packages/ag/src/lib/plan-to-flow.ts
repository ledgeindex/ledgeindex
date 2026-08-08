import type { FlowDefinition, FlowEdge, FlowNode } from './flow-schema'
import { FLOW_VERSION } from './flow-schema'
import type { CompiledFlowPreview, FlowPlan, PlanPhase } from './flow-plan'
import {
  branchArmSteps,
  branchStepNodeId,
  resolveAgentRuntimeFromPlanPhase
} from './flow-plan'
import { compilePlanPreview } from './plan-compile'
import { resolveHotkeyChordForPhase } from './plan-hotkey-chord'
import {
  controlIfDataSchema,
  controlSwitchDataSchema,
  controlIfDataFromPlanPhase,
  defaultControlIfData,
  isSwitchBranchSpec
} from './flow-control'

const CARD_W = 140
const CARD_H = 56
const RANK_GAP = 72
const ORIGIN_X = 200
const ORIGIN_Y = 80

export function phaseForNodeId(plan: FlowPlan, nodeId: string): PlanPhase | undefined {
  for (const phase of plan.phases) {
    if (`phase-${phase.phase}` === nodeId || `merge-${phase.phase}` === nodeId) return phase
    for (const branch of phase.branches ?? []) {
      const armSteps = branchArmSteps(branch)
      for (let i = 0; i < armSteps.length; i++) {
        const stepId = branchStepNodeId(phase.phase, branch.id, i, armSteps.length)
        if (stepId !== nodeId) continue
        const step = armSteps[i]
        return {
          ...phase,
          title: step.title,
          spec: step.spec,
          plan: step.plan,
          chord: branch.chord ?? phase.chord
        }
      }
    }
  }
  return undefined
}

function resolveSinkFromSpec(spec: string): string {
  const s = spec.toLowerCase()
  if (s.includes('notify')) return 'notification'
  if (s.includes('cards')) return 'cards'
  if (s.includes('gallery')) return 'gallery'
  if (s.includes('clipboard') || s.includes('copy')) return 'clipboard'
  if (s.includes('log')) return 'log'
  return 'clipboard'
}

function parsePinTypesFromPlanSpec(spec: string): string[] {
  const s = spec.toLowerCase().trim()
  if (s !== 'pin' && !s.startsWith('pin.')) return []
  const payload = s === 'pin' ? '' : s.slice('pin.'.length)
  if (!payload) return []
  return payload
    .split(/[+|,/\s]+/)
    .map((p) => p.trim())
    .filter(Boolean)
}

function resolveFlowNodeType(previewKind: string, spec: string, tag: string): string {
  const s = spec.toLowerCase()
  if (previewKind === 'branch' || tag === 'IF' || tag === 'SWITCH' || tag === 'BRANCH') {
    return isSwitchBranchSpec(spec) ? 'control.switch' : 'control.if'
  }
  if (
    previewKind === 'trigger' ||
    previewKind === 'manual' ||
    tag === 'TRIGGER' ||
    tag === 'MANUAL' ||
    tag === 'HOTKEY' ||
    tag === 'SCHEDULE' ||
    tag === 'PALETTE' ||
    s.startsWith('trigger.')
  ) {
    if (tag === 'HOTKEY' || s.includes('hotkey') || s.includes('modifier')) return 'trigger.hotkey'
    if (tag === 'SCHEDULE' || s.includes('schedule') || s.includes('cron')) return 'trigger.schedule'
    if (tag === 'PALETTE' || s.includes('palette')) return 'trigger.palette'
    return 'trigger.manual'
  }
  if (previewKind === 'action' || tag === 'DELIVER' || s.startsWith('action.') || s.startsWith('sink.')) {
    return 'output'
  }
  if (tag === 'PIN' || s === 'pin' || s.startsWith('pin.')) {
    return 'pin'
  }
  if (tag === 'MAP' || s.startsWith('control.map') || s.includes('foreach') || s.startsWith('map.')) {
    return 'control.map'
  }
  if (tag === 'DATA' || s.startsWith('data.pin') || s.includes('read.pin')) {
    return 'data.pin'
  }
  if (tag === 'PROFILE' || s.startsWith('profile.site') || s.startsWith('profile.')) {
    return 'profile.site'
  }
  if (previewKind === 'agent' || previewKind === 'subagent' || s.startsWith('agent.')) {
    return 'agent'
  }
  return 'code.ts'
}

function defaultNodeData(
  type: string,
  label: string,
  spec: string,
  phase?: PlanPhase
): Record<string, unknown> {
  if (type === 'control.if') {
    return phase
      ? controlIfDataFromPlanPhase(phase, label)
      : controlIfDataSchema.parse(defaultControlIfData(label))
  }
  if (type === 'control.switch') {
    const cases =
      phase?.branches?.map((branch) => ({
        id: branch.id,
        label: branch.title,
        value: branch.id
      })) ?? []
    return controlSwitchDataSchema.parse({
      label,
      field: 'kind',
      cases,
      defaultCaseId: cases[cases.length - 1]?.id
    })
  }
  if (type === 'trigger.hotkey') {
    const chord = phase ? resolveHotkeyChordForPhase(phase) : resolveHotkeyChordForPhase({ spec })
    return { chord, enabled: true, label }
  }
  if (type === 'trigger.schedule') {
    return { cron: '0 9 * * 1', timezone: 'Europe/Berlin', enabled: true, label }
  }
  if (type === 'output') {
    const sink = resolveSinkFromSpec(spec)
    if (sink === 'cards' || sink === 'gallery') {
      return {
        mode: 'cards',
        layout: 'pins',
        publish: { gallery: true, history: true },
        showRunIndicator: false
      }
    }
    return { mode: 'sink', sink, showRunIndicator: false }
  }
  if (type === 'pin') {
    const pinTypes = parsePinTypesFromPlanSpec(spec)
    return {
      mode: 'create',
      ...(pinTypes.length > 0 ? { pinTypes } : {}),
      userInstructions: phase?.plan,
      label
    }
  }
  if (type === 'data.pin') {
    return { pinId: '', source: 'auto', label }
  }
  if (type === 'profile.site') {
    return {
      urlPath: 'item',
      lenses: ['identity', 'capabilities', 'pricing'],
      sitemapOnly: false,
      label
    }
  }
  if (type === 'control.map') {
    return {
      itemsPath: 'items',
      concurrency: 2,
      maxItems: 0,
      onItemError: 'continue',
      label
    }
  }
  if (type === 'agent') {
    const instructions =
      (typeof phase?.agentInstructions === 'string' && phase.agentInstructions.trim()
        ? phase.agentInstructions.trim()
        : undefined) ??
      (typeof phase?.plan === 'string' ? phase.plan : undefined)
    const outputSchema =
      phase?.agentOutputSchema && typeof phase.agentOutputSchema === 'object'
        ? phase.agentOutputSchema
        : undefined
    const agentRuntime = resolveAgentRuntimeFromPlanPhase({
      spec,
      agentMode: phase?.agentMode,
      agentOutputSchema: outputSchema
    })
    return {
      label,
      agentRuntime,
      ...(instructions ? { instructions, promptTemplate: `${instructions}\n\n{{input}}` } : {}),
      ...(agentRuntime === 'structured' && outputSchema ? { outputSchema } : {})
    }
  }
  if (type === 'code.ts') {
    return {
      sourcePath: undefined,
      entry: 'main'
    }
  }
  return {}
}

function layoutPositions(
  preview: CompiledFlowPreview
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>()
  const depth = new Map<string, number>()
  preview.nodes.forEach((n) => depth.set(n.id, 0))

  let changed = true
  while (changed) {
    changed = false
    for (const edge of preview.edges) {
      const next = (depth.get(edge.source) ?? 0) + 1
      if (next > (depth.get(edge.target) ?? 0)) {
        depth.set(edge.target, next)
        changed = true
      }
    }
  }

  const byRank = new Map<number, string[]>()
  for (const node of preview.nodes) {
    const rank = depth.get(node.id) ?? 0
    const list = byRank.get(rank) ?? []
    list.push(node.id)
    byRank.set(rank, list)
  }

  for (const [rank, ids] of byRank.entries()) {
    const rowWidth = ids.length * (CARD_W + 48)
    ids.forEach((id, index) => {
      positions.set(id, {
        x: ORIGIN_X + index * (CARD_W + 48) - rowWidth / 2 + CARD_W / 2,
        y: ORIGIN_Y + rank * (CARD_H + RANK_GAP)
      })
    })
  }

  return positions
}

export type PlanToFlowResult = {
  flow: FlowDefinition
  codeNodeIds: string[]
  entryNodeId: string
}

export function compilePlanToFlowDefinition(
  plan: FlowPlan,
  flowId: string,
  opts?: { createdAt?: string; name?: string }
): PlanToFlowResult {
  const preview = compilePlanPreview(plan)
  const positions = layoutPositions(preview)
  const now = new Date().toISOString()

  const nodes: FlowNode[] = preview.nodes.map((previewNode) => {
    const phase = phaseForNodeId(plan, previewNode.id)
    const spec = phase?.spec ?? previewNode.tag
    const type = resolveFlowNodeType(previewNode.kind, spec, previewNode.tag)
    return {
      id: previewNode.id,
      type,
      position: positions.get(previewNode.id) ?? { x: ORIGIN_X, y: ORIGIN_Y },
      data: {
        label: previewNode.label,
        ...defaultNodeData(type, previewNode.label, spec, phase)
      }
    }
  })

  const edges: FlowEdge[] = preview.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle ?? null,
    targetHandle: null
  }))

  const entryNode =
    nodes.find((n) => n.type.startsWith('trigger.')) ??
    nodes[0]

  const codeNodeIds = nodes.filter((n) => n.type === 'code.ts').map((n) => n.id)

  const flow: FlowDefinition = {
    id: flowId,
    name: opts?.name ?? plan.title,
    version: FLOW_VERSION,
    nodes,
    edges,
    settings: {
      dependencies: plan.suggestedDependencies ?? plan.feasibility?.packages.suggested
    },
    createdAt: opts?.createdAt ?? now,
    updatedAt: now
  }

  return {
    flow,
    codeNodeIds,
    entryNodeId: entryNode?.id ?? nodes[0]?.id ?? ''
  }
}
