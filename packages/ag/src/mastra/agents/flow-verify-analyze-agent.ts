import { Agent } from '@mastra/core/agent'
import { DEFAULT_GOOGLE_MODEL } from '../../lib/models'

/**
 * Analyzes verify/dry-run failures and prior heal attempts, then produces a repair hint
 * for the next guided heal rounds — so the user does not have to invent a hint.
 */
export const flowVerifyAnalyzeAgent = new Agent({
  id: 'flow-verify-analyze',
  name: 'Flow Verify Analyze',
  instructions: `You analyze AutomationGhost verify failures after auto-repair stalled.

You see: failed nodes, shape/runtime errors, observed outputs (truncated), prior repair summaries, and phase plans.

Return structured JSON only with:
- summary: one short sentence for the UI timeline
- rootCause: what is actually wrong (not just restating the error)
- repairHint: concrete instructions the heal agent must follow next (field names, empty-array OK, wrap under envelope key, handle empty upstream in code, etc.)
- strategy: one of runtime_heal | agent_contract_heal | accept_as_valid | plan_revision
- focusNodeIds: 1–2 node ids to fix first (usually the upstream root cause)

Rules:
- Prefer root-cause upstream nodes over cascade failures.
- If output is a valid empty array under the declared envelope (e.g. filteredJobs: []), prefer accept_as_valid and tell heal/downstream to treat empty as success.
- If prior repairs only rewrote JSON schema repeatedly, do NOT recommend another schema tweak — change instructions, envelope wrapping, or downstream empty handling.
- repairHint must be actionable in one short paragraph.`,
  model: DEFAULT_GOOGLE_MODEL
})
