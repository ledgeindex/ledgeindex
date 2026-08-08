import type { PlanningContextBundle } from './types'

export function formatPlanningContextForPrompt(context: PlanningContextBundle): string {
  const lines: string[] = ['Planning research context (use when drafting phases):']

  if (context.docs?.status === 'skipped') {
    lines.push(`- Docs research: skipped (${context.docs.reason})`)
  } else if (context.docs && context.docs.status !== 'failed') {
    if (context.docs.findings?.length) {
      lines.push('- Docs findings:')
      for (const finding of context.docs.findings.slice(0, 6)) {
        lines.push(`  • ${finding.title}: ${finding.description}`)
      }
    }
    const source = context.docs.fetchedSources?.[0]
    lines.push(`- Docs page: ${source?.url ?? context.docs.chosenUrl ?? '(unknown)'}`)
    if (source?.title ?? context.docs.pageTitle) {
      lines.push(`- Docs title: ${source?.title ?? context.docs.pageTitle}`)
    }
    if (context.docs.excerpt) lines.push(`- Docs excerpt: ${context.docs.excerpt}`)
    if (context.docs.codeSnippets?.length) {
      lines.push(`- Code examples captured: ${context.docs.codeSnippets.length}`)
    } else if (context.docs.codeBlockCount !== undefined) {
      lines.push(`- Code examples on page: ${context.docs.codeBlockCount}`)
    }
    if (context.docs.textPreview?.length) {
      lines.push('- Docs text preview:')
      for (const block of context.docs.textPreview.slice(0, 3)) {
        lines.push(`  • ${block}`)
      }
    }
  } else if (context.docs?.status === 'failed') {
    lines.push(`- Docs research failed: ${context.docs.error ?? context.docs.reason}`)
  }

  lines.push('- Integrations pick: not run yet (stub).')

  return lines.join('\n')
}
