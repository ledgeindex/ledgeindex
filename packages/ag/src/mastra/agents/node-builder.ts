import { Agent } from '@mastra/core/agent'
import { DEFAULT_GOOGLE_MODEL } from '../../lib/models'
import { createHealWorkspace } from '../../lib/flow-builder-workspace'

const NODE_CONTRACT = `Contract (required):
- export default async function main($input, $ctx)
- $input: upstream output (unknown)
- $ctx: { runId, flowId, trigger, nodes, connectors }
- Return JSON-serializable data only

Clipboard read (step.read_clipboard / read phases):
- Use $ctx.connectors.clipboard.text (string snapshot from main process at run time)
- Do NOT invent connector methods; readText() is hydrated for legacy code only — prefer .text

Delivery separation (required):
- Do NOT call clipboard write, desktop notifications, or sink-style logging from code.ts nodes.
- Those actions belong in standalone Output nodes (sink.clipboard, sink.notification, sink.log, sink.cards) downstream.
- Code nodes shape/transform data and return objects (e.g. { text: "..." }) for the next node.

Pin artifacts (when the prompt includes pin schemas / emit_pins):
- Return an array of { pinType, title?, pin_config } matching the provided schemas exactly.
- Do not invent pin_config fields. Do not wrap the array in unrelated envelopes unless the step plan says so.`

/**
 * Codegen only — no workspace tools. Returns structured `{ code }` (full TS file).
 * Pin schemas for emit_pins steps are injected into the user prompt from the plan (not tools).
 */
export const nodeCodegenAgent = new Agent({
  id: 'node-codegen',
  name: 'Node Codegen',
  instructions: `You write TypeScript for AutomationGhost flow nodes.

${NODE_CONTRACT}

Always fill the structured output field "code" with the complete TypeScript file contents.
No markdown fences. No prose outside the code field.`,
  model: DEFAULT_GOOGLE_MODEL
})

/**
 * Heal only — workspace read/edit tools for surgical fixes after validate fails.
 */
export const nodeBuilderAgent = new Agent({
  id: 'node-builder',
  name: 'Node Builder',
  instructions: `You fix TypeScript for AutomationGhost flow nodes.

${NODE_CONTRACT}

When healing existing code:
- Use mastra_workspace_read_file to read nodes/{nodeId}.ts
- Fix reported errors with mastra_workspace_edit_file (old_string → new_string)
- Prefer surgical edits over full rewrites
- Do not modify unrelated lines`,
  model: DEFAULT_GOOGLE_MODEL,
  workspace: createHealWorkspace()
})
