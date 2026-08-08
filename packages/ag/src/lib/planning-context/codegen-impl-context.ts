import type { FlowPlan, PlanPhase } from '../flow-plan'
import type { PlanDocsCodeSnippet, PlanDocsFinding } from './plan-docs-research-fields'

const STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'as',
  'at',
  'be',
  'by',
  'for',
  'from',
  'in',
  'into',
  'is',
  'it',
  'of',
  'on',
  'or',
  'the',
  'to',
  'use',
  'using',
  'with',
  'return',
  'array',
  'jobs',
  'data',
  'step',
  'phase',
  'code',
  'node'
])

export type CodegenImplContext = {
  dependencies: string[]
  outputShape?: string
  findings: PlanDocsFinding[]
  codeSnippets: PlanDocsCodeSnippet[]
  docsUrl?: string
  docsTitle?: string
}

function tokenize(...parts: Array<string | undefined | null>): Set<string> {
  const out = new Set<string>()
  for (const part of parts) {
    if (!part) continue
    for (const raw of part.toLowerCase().match(/[a-z0-9@/_.+-]{3,}/g) ?? []) {
      const token = raw.replace(/^[@/]+/, '')
      if (!token || STOPWORDS.has(token)) continue
      out.add(token)
      // also keep package base without scope
      const slash = token.lastIndexOf('/')
      if (slash >= 0 && slash < token.length - 1) out.add(token.slice(slash + 1))
    }
  }
  return out
}

function scoreText(haystack: string, needles: Set<string>): number {
  const lower = haystack.toLowerCase()
  let score = 0
  for (const needle of needles) {
    if (lower.includes(needle)) score += needle.includes('-') || needle.includes('@') ? 4 : 1
  }
  return score
}

/**
 * npm packages this node should import — phase deps first, then suggestedDependencies
 * mentioned in the phase text.
 */
export function resolveNodeDependencies(phase: PlanPhase, plan: FlowPlan): string[] {
  const named = new Set<string>()
  for (const dep of phase.dependencies ?? []) {
    const d = dep.trim()
    if (d) named.add(d)
  }

  const suggested = plan.suggestedDependencies ?? plan.feasibility?.packages.suggested ?? {}
  const phaseText = `${phase.title} ${phase.spec} ${phase.plan}`.toLowerCase()
  for (const pkg of Object.keys(suggested)) {
    if (phaseText.includes(pkg.toLowerCase())) named.add(pkg)
  }

  return [...named]
}

/**
 * Pick docs findings/snippets relevant to this node (deps + phase keywords).
 * Falls back to a small global top set when the node has declared deps but no keyword hits.
 * Skips triggers/sinks/pins — those never consume implementation docs.
 */
export function selectCodegenImplContext(
  phase: PlanPhase,
  plan: FlowPlan
): CodegenImplContext {
  const dependencies = resolveNodeDependencies(phase, plan)
  const docs = plan.planningContext?.docs
  const spec = phase.spec.trim().toLowerCase()
  const skipDocs =
    spec.startsWith('trigger.') ||
    spec.startsWith('sink.') ||
    spec.startsWith('action.') ||
    spec === 'pin' ||
    spec.startsWith('pin.') ||
    spec.startsWith('control.') ||
    spec.startsWith('merge.')

  if (skipDocs || !docs || docs.status === 'skipped' || docs.status === 'failed') {
    return {
      dependencies,
      outputShape: phase.outputShape?.trim() || undefined,
      findings: [],
      codeSnippets: [],
      docsUrl: undefined,
      docsTitle: undefined
    }
  }

  const needles = tokenize(
    phase.title,
    phase.spec,
    phase.plan,
    phase.outputShape,
    ...dependencies
  )

  let findings = [...(docs.findings ?? [])]
    .map((finding) => ({
      finding,
      score: scoreText(`${finding.title}\n${finding.description}`, needles)
    }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map((row) => row.finding)

  const scoredSnippets = [...(docs.codeSnippets ?? [])]
    .map((snippet) => ({
      snippet,
      score: scoreText(
        `${snippet.section ?? ''}\n${snippet.language ?? ''}\n${snippet.code}`,
        needles
      )
    }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score)

  let codeSnippets = scoredSnippets.slice(0, 3).map((row) => row.snippet)

  // If this node needs a library but keyword match missed, still pass a few snippets.
  if (codeSnippets.length === 0 && dependencies.length > 0 && docs.codeSnippets?.length) {
    codeSnippets = docs.codeSnippets.slice(0, 2)
  }
  if (findings.length === 0 && dependencies.length > 0 && docs.findings?.length) {
    findings = docs.findings.slice(0, 3)
  }

  const source = docs.fetchedSources?.[0]
  return {
    dependencies,
    outputShape: phase.outputShape?.trim() || undefined,
    findings,
    codeSnippets,
    docsUrl: source?.url ?? docs.chosenUrl,
    docsTitle: source?.title ?? docs.pageTitle
  }
}

function truncate(text: string, max: number): string {
  const t = text.trim()
  return t.length <= max ? t : `${t.slice(0, max)}…`
}

/** Prompt block injected into per-node codegen / heal. */
export function formatCodegenImplContextForPrompt(ctx: CodegenImplContext): string {
  const lines: string[] = []

  if (ctx.dependencies.length) {
    lines.push('## Required npm packages (MUST import/use these — already installed for the flow)')
    for (const dep of ctx.dependencies) {
      lines.push(`- ${dep}`)
    }
    lines.push(
      'Do not substitute fetch+cheerio or invent alternate scrapers when a required package is listed.'
    )
  }

  if (ctx.outputShape) {
    lines.push('', `## Declared outputShape`, ctx.outputShape)
  }

  if (ctx.findings.length || ctx.codeSnippets.length) {
    lines.push('', '## Implementation knowledge (from docs research — use for this node)')
    if (ctx.docsUrl) {
      lines.push(`Source: ${ctx.docsTitle ? `${ctx.docsTitle} — ` : ''}${ctx.docsUrl}`)
    }
    for (const finding of ctx.findings) {
      lines.push(`- ${finding.title}: ${truncate(finding.description, 320)}`)
    }
    for (const [i, snippet] of ctx.codeSnippets.entries()) {
      const lang = snippet.language?.trim() || 'ts'
      const section = snippet.section?.trim()
      lines.push(
        '',
        `### Example ${i + 1}${section ? ` (${section})` : ''} [${lang}]`,
        truncate(snippet.code, 1200)
      )
    }
  }

  return lines.length ? `\n${lines.join('\n')}\n` : ''
}
