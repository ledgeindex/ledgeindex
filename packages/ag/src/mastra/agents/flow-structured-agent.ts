import { Agent } from '@mastra/core/agent'
import { resolveChatModelConfig } from '../../lib/chat-models'
import { isLmStudioRouterId } from '../../lib/lm-studio'
import { DEFAULT_GOOGLE_MODEL } from '../../lib/models'

/**
 * Ephemeral structured agent for flow agent.* nodes.
 * Instructions + JSON Schema come from the plan / node data at run time (requestContext + generate options).
 */
export const flowStructuredAgent = new Agent({
  id: 'flow-structured-agent',
  name: 'Flow Structured Agent',
  instructions: ({ requestContext }) => {
    const fromCtx = requestContext?.get('agent_instructions')
    if (typeof fromCtx === 'string' && fromCtx.trim()) return fromCtx.trim()
    return `You process upstream automation JSON and return ONLY data that matches the provided structured output schema.
Follow the user message criteria carefully. Do not invent fields outside the schema.`
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
