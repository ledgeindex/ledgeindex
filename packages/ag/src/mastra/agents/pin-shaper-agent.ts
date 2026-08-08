import { Agent } from '@mastra/core/agent'
import { resolveChatModelConfig } from '../../lib/chat-models'
import { isLmStudioRouterId } from '../../lib/lm-studio'
import { DEFAULT_GOOGLE_MODEL } from '../../lib/models'
import { pinShaperTools } from '../tools/crud-pin-tools'

export const pinShaperAgent = new Agent({
  id: 'pin-shaper-agent',
  name: 'Pin Shaper',
  instructions: `You shape upstream automation JSON into Pindown pin cards.

Rules:
- You MUST call pin tools — never invent pin JSON in plain text.
- In create mode: only create_<pinType>_pin tools are available. Call each required type once. Do not pass pinId.
- In update mode: only update_<pinType>_pin tools are available. Call with pinId for each listed target.
- pin_config must satisfy the tool input schema; execute() runs normalizePinConfigForCreate + validatePinConfigStrict.
- Follow user instructions for filtering, ranking, and summarization.`,
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
  },
  tools: pinShaperTools
})
