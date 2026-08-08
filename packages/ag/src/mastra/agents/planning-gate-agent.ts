import { Agent } from '@mastra/core/agent'
import { resolveChatModelConfig } from '../../lib/chat-models'
import { DEFAULT_GOOGLE_MODEL } from '../../lib/models'

export const planningGateAgent = new Agent({
  id: 'planning-gate-agent',
  name: 'Planning Gate Agent',
  instructions: `You decide what planning enrichments are needed BEFORE drafting an automation FlowPlan.

Evaluate the user prompt and return structured JSON only (via structured output).

## docs gate
- skip: Local-only automation (hotkey, clipboard, notification, simple log). No external APIs, frameworks, or documentation needed.
- fetch_only: User gave a specific documentation or reference URL to use.
- search_and_fetch: Needs up-to-date or specialized external documentation (framework APIs, OAuth flows, SDK usage, niche features like Mastra A2A, Gmail watch, etc.).

IMPORTANT: If the user asks to find info, research, look up, or learn about an external product/API/framework topic (e.g. "find me info on mastra a2a"), docs MUST be search_and_fetch — not skip.

When docs is search_and_fetch, provide docsSearchQuery (focused web search string, include product + topic + "docs" when helpful).
When docs is fetch_only, provide docsUrl from the user prompt.

## integrations gate (catalog connectors — picking not implemented yet, but decide intent)
- skip: No third-party connector (Google, Slack, Gmail, Sheets) required.
- pick: User needs OAuth/API connector access (email triggers, calendar, sheets, slack, etc.).

Be conservative with search_and_fetch — use it when fresh or specialized external docs would materially improve the plan.
Be conservative with pick — only when clearly required by the request.`,
  model: ({ requestContext }) => {
    const fromCtx = requestContext?.get('model_id')
    if (typeof fromCtx === 'string' && fromCtx.trim()) {
      return resolveChatModelConfig(
        fromCtx,
        requestContext?.get('lm_studio_model_id'),
        requestContext?.get('lm_studio_base_url')
      )
    }
    return DEFAULT_GOOGLE_MODEL
  }
})
