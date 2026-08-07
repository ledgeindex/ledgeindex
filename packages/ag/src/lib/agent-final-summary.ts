/**
 * Prefer the last LLM step's text so repair UIs show the final answer,
 * not the agent's pre-tool "I will inspect…" planning narration.
 */
export function extractAgentFinalSummary(
  result: {
    text?: string | null
    steps?: Array<{ text?: string | null } | null | undefined> | null
  },
  fallback: string,
  maxLen = 500
): string {
  const steps = result.steps ?? []
  for (let i = steps.length - 1; i >= 0; i--) {
    const stepText = steps[i]?.text?.trim()
    if (stepText) return clampSummary(preferPastTenseTail(stepText), maxLen)
  }

  const full = result.text?.trim()
  if (!full) return fallback
  return clampSummary(preferPastTenseTail(full), maxLen)
}

function preferPastTenseTail(text: string): string {
  const blocks = text
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean)
  if (blocks.length <= 1) {
    // If the whole blob is planning ("I will…"), keep it but caller instructions should prevent this.
    return text.trim()
  }
  // Last non-planning block wins when earlier blocks are inspection plans.
  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i]!
    if (!looksLikeInspectionPlan(block)) return block
  }
  return blocks[blocks.length - 1]!
}

function looksLikeInspectionPlan(text: string): boolean {
  const head = text.slice(0, 160).toLowerCase()
  return (
    /^i will\b/.test(head) ||
    /^i'll\b/.test(head) ||
    /^let me\b/.test(head) ||
    /^first[, ]/.test(head) ||
    head.includes('i will start by') ||
    head.includes('i will read')
  )
}

function clampSummary(text: string, maxLen: number): string {
  const trimmed = text.trim()
  if (trimmed.length <= maxLen) return trimmed
  return `${trimmed.slice(0, maxLen - 1).trimEnd()}…`
}
