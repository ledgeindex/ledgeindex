import { Agent } from '@mastra/core/agent'
import { resolveChatModelConfig } from '../../lib/chat-models'
import { googleWebSearchTool } from '../tools/google-web-search-tool'
import { searchPlacesTool } from '../tools/google-maps-grounding-tool'
import { urlContextTool } from '../tools/url-context-tool'
// import { workspaceSearchTool } from '../tools/workspace-search-tool'
import { listKnowledgeSourcesTool } from '../tools/list-knowledge-sources-tool'
import { queryKnowledgeSourceTool } from '../tools/query-knowledge-source-tool'

const DESKTOP_CHAT_INSTRUCTIONS = `You are AutomationGhost — a helpful local assistant.

You can:
- Answer questions and help plan automations
- Search the web (google_web_search) for current information and documentation
- Read a specific URL the user provides (url_context)
- Find local businesses and places (search_places)
- List indexed documentation / knowledge sources (list_knowledge_sources)
- Ask questions against one indexed source (query_knowledge_source)

When to use tools:
- google_web_search — open-ended research, docs, news, facts on the public web
- url_context — user pasted or named one http(s) URL to read
- search_places — businesses, shops, restaurants, services near a city or coordinates
- list_knowledge_sources — user asks what docs/sources are available, or you need a slug before querying
- query_knowledge_source — user wants an answer from a specific indexed docs site or knowledge base; use slug from list_knowledge_sources

Call list_knowledge_sources when the user has multiple sources or did not name which one. Prefer query_knowledge_source for Q&A on indexed documentation.

Be concise. Cite sources when search or URL tools return them. When query_knowledge_source returns an answer, mention the source name or slug.`

export const desktopChatAgent = new Agent({
  id: 'desktop-chat-agent',
  name: 'AutomationGhost',
  instructions: DESKTOP_CHAT_INSTRUCTIONS,
  model: ({ requestContext }) => {
    const fromCtx = requestContext?.get('model_id')
    const lmModelId = requestContext?.get('lm_studio_model_id')
    const lmBaseUrl = requestContext?.get('lm_studio_base_url')
    return resolveChatModelConfig(fromCtx, lmModelId, lmBaseUrl)
  },
  tools: {
    googleWebSearchTool,
    urlContextTool,
    searchPlacesTool,
    // workspaceSearchTool,
    listKnowledgeSourcesTool,
    queryKnowledgeSourceTool
  }
})

export { DEFAULT_CHAT_MODEL_ID as DESKTOP_CHAT_DEFAULT_MODEL } from '../../lib/chat-models'
