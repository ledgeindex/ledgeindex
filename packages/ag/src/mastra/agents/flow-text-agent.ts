import { Agent } from '@mastra/core/agent'
import { resolveChatModelConfig } from '../../lib/chat-models'
import { isLmStudioRouterId } from '../../lib/lm-studio'
import { DEFAULT_GOOGLE_MODEL } from '../../lib/models'

/**
 * Built-in free-text agent for flow agent nodes (no structuredOutput).
 * Instructions come from node/plan via requestContext.
 */
export const flowTextAgent = new Agent({
  id: 'flow-text-agent',
  name: 'Flow Text Agent',
  instructions: ({ requestContext }) => {
    const fromCtx = requestContext?.get('agent_instructions')
    if (typeof fromCtx === 'string' && fromCtx.trim()) return fromCtx.trim()
    return `You process upstream automation data and write a clear plain-text response.
Do not invent JSON schemas. Prefer concise prose the next step can show or copy.`
  },
  model: ({ requestContext }) => {
    const flowModel = requestContext?.get('flow_model')
    const modelId =
      typeof flowModel === 'string' && flowModel.trim().includes('/')
        ? flowModel.trim()
        : DEFAULT_GOOGLE_MODEL
    if (isLmStudioRouterId(modelId)) {
      return resolveChatModelConfig(
        modelId,
        requestContext?.get('lm_studio_model_id'),
        requestContext?.get('lm_studio_base_url')
      )
    }
    return modelId
  }
})
