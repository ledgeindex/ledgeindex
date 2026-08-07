import { Agent } from '@mastra/core/agent'
import { DEFAULT_GOOGLE_MODEL } from '../../lib/models'

/**
 * Repairs agent-node contracts (instructions + JSON Schema + outputShape) after verify failures.
 * Does not edit code.ts — that is flow-repair's job.
 */
export const flowAgentContractRepairAgent = new Agent({
  id: 'flow-agent-contract-repair',
  name: 'Flow Agent Contract Repair',
  instructions: `You repair AutomationGhost agent-node contracts after a verify/dry-run failure.

You receive: runtime/shape error, current agentMode, instructions, outputSchema (JSON Schema), outputShape, and optional observed output / upstream sample / user hint.

Return structured JSON only (via the provided schema) with a fixed contract.

Rules:
- Prefer agentMode "structured" when downstream needs stable fields (filters, tables, pins).
- Prefer agentMode "text" only for free-prose summarize/rewrite with no JSON contract.
- structured → agentInstructions + agentOutputSchema (valid JSON Schema object with type/properties/required) + short outputShape string.
- text → agentInstructions only; set agentOutputSchema to null; outputShape like "{ text: string }".
- Align schema property names with OBSERVED upstream data and the error message (e.g. matches vs books).
- If observed output is empty / "none", rewrite agentInstructions so the model always returns the required envelope object — do not only tweak schema.
- When prior repair attempts are listed, do not repeat the same change; pick a meaningfully different strategy.
- Keep schemas minimal and runnable — no inventing unrelated fields.
- summary: one short sentence describing what you changed.`,
  model: DEFAULT_GOOGLE_MODEL
})
