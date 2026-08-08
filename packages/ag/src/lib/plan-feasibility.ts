import type { CapabilityCatalog } from './builtin-catalog'
import type {
  FeasibilityComplexity,
  FlowPlan,
  PlanFeasibility,
  PlanRiskFlag
} from './flow-plan'
import { collectDeclaredDependencies } from './flow-plan'

const OAUTH_PATTERN = /\b(oauth|gmail|google sheets|slack|login required)\b/i
const ANTI_BOT_PATTERN = /\b(linkedin|instagram|captcha|anti-bot|anti bot)\b/i

/** Declared package names that imply a heavier install — set lookup only, not text scan. */
const HEAVY_PACKAGE_NAMES = new Set([
  'puppeteer',
  'playwright',
  '@browserbasehq/stagehand',
  'sharp'
])

function scanPhaseText(plan: FlowPlan): string {
  return plan.phases
    .flatMap((phase) => [
      phase.title,
      phase.spec,
      phase.plan,
      ...(phase.branches?.flatMap((b) => [b.title, b.spec, b.plan]) ?? [])
    ])
    .join('\n')
}

/** Packages come only from planner structured fields — never guessed from prose. */
function packagesFromPlan(plan: FlowPlan): {
  suggested: Record<string, string>
  flags: Array<'browser' | 'native' | 'heavy'>
} {
  const suggested: Record<string, string> = {}
  for (const name of collectDeclaredDependencies(plan)) {
    suggested[name] = plan.suggestedDependencies?.[name] ?? 'latest'
  }

  const flags = new Set<'browser' | 'native' | 'heavy'>()
  for (const name of Object.keys(suggested)) {
    if (HEAVY_PACKAGE_NAMES.has(name)) {
      flags.add('heavy')
      flags.add('browser')
    }
  }

  return { suggested, flags: [...flags] }
}

function partitionConnectors(plan: FlowPlan, catalog: CapabilityCatalog) {
  const required = [...new Set(plan.connectorsNeeded)]
  const ready: string[] = []
  const missingAuth: string[] = []
  const unavailable: string[] = []

  for (const id of required) {
    const entry = catalog.byId.get(id)
    if (!entry) {
      unavailable.push(id)
      continue
    }
    if (entry.authStatus === 'ready') ready.push(id)
    else if (entry.authStatus === 'missing') missingAuth.push(id)
    else unavailable.push(id)
  }

  return { required, ready, missingAuth, unavailable }
}

function deriveComplexity(
  plan: FlowPlan,
  unavailable: string[],
  missingAuth: string[],
  packageFlags: Array<'browser' | 'native' | 'heavy'>
): FeasibilityComplexity {
  const phaseCount = plan.phases.length
  const hasBranches = plan.phases.some((p) => (p.branches?.length ?? 0) > 0)
  const agentic = plan.flowKind === 'agentic' || plan.phases.some((p) => p.spec.startsWith('agent.'))

  if (unavailable.length > 0 || agentic) return 'expert'
  if (packageFlags.includes('browser') || phaseCount > 6 || hasBranches || missingAuth.length > 1) {
    return 'advanced'
  }
  if (phaseCount > 3 || missingAuth.length > 0 || plan.flowKind === 'branching') return 'intermediate'
  return 'basic'
}

const complexityLabel = (complexity: FeasibilityComplexity): string =>
  complexity.charAt(0).toUpperCase() + complexity.slice(1)

export function assessPlanFeasibility(plan: FlowPlan, catalog: CapabilityCatalog): PlanFeasibility {
  const connectors = partitionConnectors(plan, catalog)
  const { suggested, flags } = packagesFromPlan(plan)
  const corpus = scanPhaseText(plan)
  const risks: PlanFeasibility['risks'] = []

  const pushRisk = (
    flag: PlanRiskFlag,
    severity: 'info' | 'warning' | 'blocker',
    message: string,
    mitigation?: string
  ): void => {
    risks.push({ flag, severity, message, mitigation })
  }

  for (const id of connectors.missingAuth) {
    pushRisk(
      'oauth_missing',
      'warning',
      `Connector "${id}" needs authentication.`,
      'Connect the account in Settings when available.'
    )
  }

  for (const id of connectors.unavailable) {
    pushRisk(
      'no_catalog_match',
      'blocker',
      `Unknown connector "${id}" — revise the plan to use built-in capabilities.`,
      'Ask the planner to replace this with clipboard, notification, or code.ts.'
    )
  }

  if (ANTI_BOT_PATTERN.test(corpus)) {
    pushRisk('anti_bot', 'warning', 'Target site may block automated access.')
  }

  if (OAUTH_PATTERN.test(corpus) && connectors.missingAuth.length > 0) {
    pushRisk('oauth_required', 'info', 'OAuth or API keys will be required for some steps.')
  }

  if (flags.includes('browser') || flags.includes('heavy')) {
    pushRisk('heavy_npm', 'info', 'Heavy npm packages may take longer to install on first run.')
  }

  const complexity = deriveComplexity(plan, connectors.unavailable, connectors.missingAuth, flags)
  const hasBlocker = risks.some((r) => r.severity === 'blocker')

  let gate: PlanFeasibility['gate'] = 'ready'
  if (hasBlocker) gate = 'likely_blocked'
  else if (connectors.missingAuth.length > 0) gate = 'needs_user_action'
  else if (Object.keys(suggested).length > 0) gate = 'needs_setup'

  const achievable = gate !== 'likely_blocked'

  const summary =
    gate === 'likely_blocked'
      ? 'Blocked — revise connectors or scope before building.'
      : gate === 'needs_user_action'
        ? `${complexityLabel(complexity)} — setup or auth required before run.`
        : gate === 'needs_setup'
          ? `${complexityLabel(complexity)} — npm install likely on first run.`
          : `${complexityLabel(complexity)} — ready to build.`

  return {
    complexity,
    gate,
    achievable,
    summary,
    connectors,
    packages: {
      suggested,
      estimatedCount: Object.keys(suggested).length,
      flags
    },
    risks
  }
}
