import { z } from 'zod'

export const planBranchStepSchema = z.object({
  title: z.string(),
  spec: z.string(),
  plan: z.string(),
  /** npm package names this step needs installed (planner structured output). */
  dependencies: z.array(z.string().min(1)).optional()
})

export const planBranchSchema = z.object({
  id: z.string(),
  title: z.string(),
  spec: z.string(),
  plan: z.string(),
  /** Hotkey chord when spec is trigger.hotkey — e.g. Ctrl+Shift+S */
  chord: z.string().optional(),
  /** Ordered nodes on this arm — use when transform + sink (or multiple steps) are needed. */
  steps: z.array(planBranchStepSchema).min(1).optional(),
  /** npm packages for this arm when steps[] is omitted. */
  dependencies: z.array(z.string().min(1)).optional()
})

export type PlanBranchStep = z.infer<typeof planBranchStepSchema>
export type PlanBranch = z.infer<typeof planBranchSchema>

export function branchArmSteps(branch: PlanBranch): PlanBranchStep[] {
  if (branch.steps?.length) return branch.steps
  return [
    {
      title: branch.title,
      spec: branch.spec,
      plan: branch.plan,
      ...(branch.dependencies?.length ? { dependencies: branch.dependencies } : {})
    }
  ]
}

export function branchStepNodeId(
  phaseId: string,
  branchId: string,
  stepIndex: number,
  stepCount: number
): string {
  if (stepCount === 1) return `phase-${phaseId}-${branchId}`
  const idx = String(stepIndex + 1).padStart(2, '0')
  return `phase-${phaseId}-${branchId}-${idx}`
}

export const agentModeSchema = z.enum(['structured', 'text'])
export type AgentMode = z.infer<typeof agentModeSchema>

const planPhaseObjectSchema = z.object({
  phase: z.string(),
  title: z.string(),
  spec: z.string(),
  plan: z.string(),
  /** Hotkey chord when spec is trigger.hotkey — e.g. Ctrl+Shift+S */
  chord: z.string().optional(),
  /**
   * Declared JSON shape this phase returns for downstream (e.g. `Job[] { title, company, jobUrl }`).
   * Used by codegen upstream hints and post-build verify asserts.
   */
  outputShape: z.string().optional(),
  /**
   * Agent phases (`agent.*`): explicit runtime mode — source of truth for text vs structured.
   * `structured` requires agentOutputSchema; `text` must omit it.
   */
  agentMode: agentModeSchema.optional(),
  /**
   * Agent phases (`agent.*`): instructions for the agent at runtime.
   * Prefer this over burying filter criteria only in `plan`.
   */
  agentInstructions: z.string().optional(),
  /**
   * Agent phases: JSON Schema object passed to Mastra `structuredOutput.schema`.
   * Required when agentMode is `structured`; omit for `text`.
   */
  agentOutputSchema: z.record(z.string(), z.unknown()).optional(),
  /** npm package names this phase's code needs installed (planner structured output). */
  dependencies: z.array(z.string().min(1)).optional(),
  branches: z.array(planBranchSchema).optional()
})

function refineAgentPhaseFields(
  phase: z.infer<typeof planPhaseObjectSchema>,
  ctx: z.RefinementCtx
): void {
  const spec = phase.spec.trim().toLowerCase()
  if (!spec.startsWith('agent.')) return
  if (phase.agentMode !== 'structured' && phase.agentMode !== 'text') return

  if (!phase.agentInstructions?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `${phase.agentMode} agent phases require agentInstructions`,
      path: ['agentInstructions']
    })
  }

  if (phase.agentMode === 'structured') {
    if (!phase.agentOutputSchema || typeof phase.agentOutputSchema !== 'object') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'structured agent phases require agentOutputSchema',
        path: ['agentOutputSchema']
      })
    }
  } else if (phase.agentOutputSchema != null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'text agent phases must omit agentOutputSchema',
      path: ['agentOutputSchema']
    })
  }
}

export const planPhaseSchema = planPhaseObjectSchema.superRefine(refineAgentPhaseFields)

/** Infer agentMode for agent.* phases when the planner omitted it (legacy / soft fail). */
export function inferAgentModeFromPhase(phase: {
  spec: string
  agentMode?: AgentMode
  agentOutputSchema?: Record<string, unknown>
}): AgentMode | undefined {
  if (!phase.spec.trim().toLowerCase().startsWith('agent.')) return undefined
  if (phase.agentMode === 'structured' || phase.agentMode === 'text') return phase.agentMode

  const hasSchema = Boolean(phase.agentOutputSchema && typeof phase.agentOutputSchema === 'object')
  if (hasSchema) return 'structured'

  const specLower = phase.spec.toLowerCase()
  if (
    specLower.includes('agent.text') ||
    specLower.includes('agent.summary') ||
    specLower.includes('agent.prose')
  ) {
    return 'text'
  }
  if (
    specLower.includes('agent.filter') ||
    specLower.includes('agent.score') ||
    specLower.includes('agent.classify') ||
    specLower.includes('agent.extract')
  ) {
    return 'structured'
  }
  return hasSchema ? 'structured' : 'text'
}

/** Fill missing agentMode on agent.* phases so plan→flow never has to guess from spec alone. */
export function normalizePlanAgentModes<
  T extends { phases: Array<z.infer<typeof planPhaseObjectSchema>> }
>(plan: T): T {
  let changed = false
  const phases = plan.phases.map((phase) => {
    const mode = inferAgentModeFromPhase(phase)
    if (!mode || phase.agentMode === mode) return phase
    // Only stamp when fields already satisfy refine — avoids breaking re-parse.
    if (mode === 'structured') {
      if (!phase.agentInstructions?.trim() || !phase.agentOutputSchema) return phase
    } else if (!phase.agentInstructions?.trim() || phase.agentOutputSchema != null) {
      return phase
    }
    changed = true
    return { ...phase, agentMode: mode }
  })
  return changed ? { ...plan, phases } : plan
}

/** Map plan phase → node agentRuntime (`stored` is UI-only). */
export function resolveAgentRuntimeFromPlanPhase(phase: {
  spec: string
  agentMode?: AgentMode
  agentOutputSchema?: Record<string, unknown>
}): 'structured' | 'text' {
  return inferAgentModeFromPhase(phase) ?? 'text'
}

export const feasibilityComplexitySchema = z.enum([
  'basic',
  'intermediate',
  'advanced',
  'expert'
])
export const feasibilityGateSchema = z.enum([
  'ready',
  'needs_setup',
  'needs_user_action',
  'likely_blocked'
])

export const planRiskFlagSchema = z.enum([
  'oauth_required',
  'oauth_missing',
  'web_scraping',
  'anti_bot',
  'paid_api',
  'no_catalog_match',
  'heavy_npm',
  'long_running',
  'legal_sensitive'
])

export const planFeasibilitySchema = z.object({
  complexity: feasibilityComplexitySchema,
  gate: feasibilityGateSchema,
  achievable: z.boolean(),
  summary: z.string(),
  connectors: z.object({
    required: z.array(z.string()),
    ready: z.array(z.string()),
    missingAuth: z.array(z.string()),
    unavailable: z.array(z.string())
  }),
  packages: z.object({
    suggested: z.record(z.string(), z.string()),
    estimatedCount: z.number(),
    flags: z.array(z.enum(['browser', 'native', 'heavy']))
  }),
  risks: z.array(
    z.object({
      flag: planRiskFlagSchema,
      severity: z.enum(['info', 'warning', 'blocker']),
      phaseId: z.string().optional(),
      message: z.string(),
      mitigation: z.string().optional()
    })
  )
})

export const compiledFlowPreviewSchema = z.object({
  nodeCount: z.number(),
  edgeCount: z.number(),
  nodes: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      tag: z.string(),
      kind: z.string()
    })
  ),
  edges: z.array(
    z.object({
      id: z.string(),
      source: z.string(),
      target: z.string(),
      dashed: z.boolean().optional(),
      sourceHandle: z.string().optional()
    })
  )
})

export const flowKindSchema = z.enum(['manual', 'event', 'branching', 'agentic'])

export const planningGateDocsSchema = z.enum(['skip', 'fetch_only', 'search_and_fetch'])

export const planningGateIntegrationsSchema = z.enum(['skip', 'pick'])

const planDocsFindingSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
})

const planFetchedSourceSchema = z.object({
  url: z.string().url(),
  title: z.string().min(1),
  excerpt: z.string().optional(),
})

const planDocsCodeSnippetSchema = z.object({
  language: z.string().nullable().optional(),
  section: z.string().nullable().optional(),
  code: z.string().min(1),
})

export const planDocsSearchSourceSchema = z.object({
  rank: z.number().int().positive(),
  url: z.string(),
  title: z.string(),
  snippet: z.string().optional(),
})

export const planDocsResearchSchema = z.object({
  status: z.enum(['skipped', 'fetch_only', 'search_and_fetch', 'failed']),
  reason: z.string(),
  query: z.string().optional(),
  chosenUrl: z.string().optional(),
  pageTitle: z.string().optional(),
  excerpt: z.string().optional(),
  textPreview: z.array(z.string()).max(8).optional(),
  codeBlockCount: z.number().int().nonnegative().optional(),
  searchSources: z.array(planDocsSearchSourceSchema).optional(),
  findings: z.array(planDocsFindingSchema).max(12).optional(),
  fetchedSources: z.array(planFetchedSourceSchema).max(4).optional(),
  codeSnippets: z.array(planDocsCodeSnippetSchema).max(8).optional(),
  error: z.string().optional(),
})

export const planningContextSchema = z.object({
  gates: z.object({
    docs: planningGateDocsSchema,
    integrations: planningGateIntegrationsSchema,
  }),
  docs: planDocsResearchSchema.optional(),
  integrations: z
    .object({
      status: z.literal('not_implemented'),
      reason: z.string(),
    })
    .optional(),
})

export const flowPlanSchema = z.object({
  version: z.literal(1),
  title: z.string(),
  summary: z.string(),
  slug: z.string(),
  flowKind: flowKindSchema,
  phases: z.array(planPhaseSchema).min(1),
  connectorsNeeded: z.array(z.string()),
  suggestedDependencies: z.record(z.string(), z.string()).optional(),
  feasibility: planFeasibilitySchema.optional(),
  mermaid: z.string().optional(),
  compiledPreview: compiledFlowPreviewSchema.optional(),
  planningContext: planningContextSchema.optional(),
})

/** LLM structured-output shape — omit version (Gemini rejects numeric enum literals). */
export const flowPlanPlannerSchema = flowPlanSchema.omit({
  version: true,
  feasibility: true,
  compiledPreview: true,
  mermaid: true,
  // Injected after research — do not let the planner invent gates.
  planningContext: true
})

export type PlanRiskFlag = z.infer<typeof planRiskFlagSchema>
export type PlanPhase = z.infer<typeof planPhaseSchema>
export type FeasibilityComplexity = z.infer<typeof feasibilityComplexitySchema>
export type PlanFeasibility = z.infer<typeof planFeasibilitySchema>
export type CompiledFlowPreview = z.infer<typeof compiledFlowPreviewSchema>
export type FlowKind = z.infer<typeof flowKindSchema>
export type PlanningContextBundle = z.infer<typeof planningContextSchema>
export type FlowPlan = z.infer<typeof flowPlanSchema>

/** npm names the planner declared on phases / branch steps / plan.suggestedDependencies. */
export function collectDeclaredDependencies(plan: FlowPlan): string[] {
  const names = new Set<string>()

  const add = (list?: string[]): void => {
    for (const raw of list ?? []) {
      const name = raw.trim()
      if (name) names.add(name)
    }
  }

  add(Object.keys(plan.suggestedDependencies ?? {}))

  for (const phase of plan.phases) {
    add(phase.dependencies)
    for (const branch of phase.branches ?? []) {
      add(branch.dependencies)
      for (const step of branchArmSteps(branch)) {
        add(step.dependencies)
      }
    }
  }

  return [...names].sort((a, b) => a.localeCompare(b))
}

export function slugifyPlanTitle(title: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  return base || 'automation'
}

export function parseFlowPlan(raw: unknown): FlowPlan {
  return normalizePlanAgentModes(flowPlanSchema.parse(raw))
}
