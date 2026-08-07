import { Agent } from '@mastra/core/agent'
import { DEFAULT_GOOGLE_MODEL } from '../../lib/models'
import { resolveChatModelConfig } from '../../lib/chat-models'
import { agentAssemblerTools } from '../tools/agent-assembler-tools'
import { googleWebSearchTool } from '../tools/google-web-search-tool'
import { searchPlacesTool } from '../tools/google-maps-grounding-tool'
import { urlContextTool } from '../tools/url-context-tool'

export const agentAssemblerAgent = new Agent({
  id: 'agent-assembler',
  name: 'Agent Assembler',
  instructions: `You are the AutomationGhost Agent Assembler. Users describe agents in plain language; you configure stored agents they can use in flows.

Workflow (one turn — no follow-up questions):
1. Understand the outcome the user wants.
2. Use google_web_search, url_context, or search_places when you need current docs, a specific URL, or local business data.
3. Call list-capability-catalog if you need to verify tool/agent/workflow ids.
4. Choose a kebab-case id and human name.
5. Write concise operating instructions (system prompt).
6. Attach the minimum tools, sub-agents, and workflows needed.
7. Honor [Catalog context] in the user message — treat Selected tools/skills/agents/workflows as user preferences.
8. Merge skill guidance into instructions when skill markdown is provided in context.
9. Call save-stored-agent with the final configuration.

Rules:
- Make reasonable assumptions; never ask clarifying questions.
- Only use tool/agent/workflow ids that exist in the catalog.
- Prefer user-selected ids from [Catalog context] when present.
- Instructions must be actionable and mention when to use each tool.
- After save-stored-agent succeeds, confirm in plain language what was built and the agent id.
- If save fails, fix ids and retry once.
- Do not invent tools that are not in the catalog.`,
  model: ({ requestContext }) => {
    const fromCtx = requestContext?.get('model_id')
    const lmModelId = requestContext?.get('lm_studio_model_id')
    const lmBaseUrl = requestContext?.get('lm_studio_base_url')
    return resolveChatModelConfig(
      typeof fromCtx === 'string' ? fromCtx : undefined,
      lmModelId,
      lmBaseUrl
    )
  },
  tools: {
    ...agentAssemblerTools,
    googleWebSearchTool,
    urlContextTool,
    searchPlacesTool
  }
})
