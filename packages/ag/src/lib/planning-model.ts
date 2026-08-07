import { RequestContext } from '@mastra/core/request-context'
import { resolveChatModelConfig, resolveChatModelId, type ChatModelConfig } from './chat-models'
import {
  buildLmStudioRouterId,
  isLmStudioRouterId,
  stripLmStudioRouterPrefix
} from './lm-studio'
import { DEFAULT_GOOGLE_MODEL } from './models'

export type PlanningModelSelection = {
  modelId?: string | null
  lmStudioModelId?: string | null
  lmStudioBaseUrl?: string | null
}

export function resolvePlanningModelConfig(selection?: PlanningModelSelection): ChatModelConfig {
  const modelId = String(selection?.modelId ?? '').trim()
  if (!modelId) return DEFAULT_GOOGLE_MODEL
  return resolveChatModelConfig(
    modelId,
    selection?.lmStudioModelId,
    selection?.lmStudioBaseUrl
  )
}

export function buildPlanningRequestContext(
  selection?: PlanningModelSelection
): RequestContext {
  const modelId = String(selection?.modelId ?? '').trim()
  const resolved = modelId ? resolveChatModelId(modelId) : DEFAULT_GOOGLE_MODEL
  const entries: Array<[string, string]> = [['model_id', resolved]]

  if (isLmStudioRouterId(resolved)) {
    const override = String(selection?.lmStudioModelId ?? '').trim()
    const lmModelId = override || stripLmStudioRouterPrefix(resolved)
    entries.push(['lm_studio_model_id', lmModelId])
    entries[0] = ['model_id', buildLmStudioRouterId(lmModelId)]
    const baseUrl = String(selection?.lmStudioBaseUrl ?? '').trim()
    if (baseUrl) entries.push(['lm_studio_base_url', baseUrl])
  }

  return new RequestContext(entries)
}
