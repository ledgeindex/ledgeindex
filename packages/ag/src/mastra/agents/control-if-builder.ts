import { Agent } from '@mastra/core/agent'
import { DEFAULT_GOOGLE_MODEL } from '../../lib/models'

export const controlIfBuilderAgent = new Agent({
  id: 'control-if-builder',
  name: 'Control If Builder',
  instructions: `You configure AutomationGhost control.if nodes AFTER upstream code.ts nodes were generated.

You receive:
- The upstream node's TypeScript source and inferred return keys
- The IF phase plan text (what branch logic should do)
- Then/Else branch descriptions

Output structured JSON only:
- field: dot path on upstream $input — MUST be a top-level key the upstream node actually returns (or empty string to test whole $input)
- operator: truthy | falsy | contains | equals | gt | gte | lt | lte
- compareValue: required for contains/equals/numeric ops
- label: short label for the IF node

Rules:
- field MUST exist in the upstream return keys when keys are known — never invent fields
- Prefer the field the upstream step clearly populates for the condition (e.g. text for clipboard content)
- Match operator and compareValue to the IF phase plan intent
- Do NOT output thenDescription or elseDescription — the engine sets those from plan branches`,
  model: DEFAULT_GOOGLE_MODEL
})
