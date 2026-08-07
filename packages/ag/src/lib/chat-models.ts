import type { OpenAICompatibleConfig } from '@mastra/core/dist/llm/model/shared.types.js'
import {
  DEFAULT_LM_STUDIO_BASE_URL,
  buildLmStudioRouterId,
  isLmStudioRouterId,
  resolveLmStudioModelId
} from './lm-studio'

/** Google chat models — aligned with Pindown desktop chat. */
export const CHAT_MODEL_IDS = [
  'google/gemini-3.5-flash-lite',
  'google/gemini-3.6-flash'
] as const

export const DEFAULT_CHAT_MODEL_ID = 'google/gemini-3.5-flash-lite'

const LEGACY_CHAT_MODEL_IDS: Record<string, string> = {
  'google/gemini-3.1-flash-lite-preview': 'google/gemini-3.5-flash-lite',
  'google/gemini-3.5-flash-lite-preview': 'google/gemini-3.5-flash-lite',
  'google/gemini-3.5-flash': 'google/gemini-3.6-flash',
  'google/gemini-3-flash-preview': 'google/gemini-3.6-flash',
  'google/gemini-3.1-pro-preview': 'google/gemini-3.6-flash'
}

export function migrateChatModelId(modelId: string): string {
  const trimmed = modelId.trim()
  return LEGACY_CHAT_MODEL_IDS[trimmed] ?? trimmed
}

export type ChatModelConfig = string | OpenAICompatibleConfig

export function isAllowedChatModelId(model: string): boolean {
  const migrated = migrateChatModelId(model)
  if (CHAT_MODEL_IDS.includes(migrated as (typeof CHAT_MODEL_IDS)[number])) return true
  if (isLmStudioRouterId(migrated)) return true
  if (migrated.startsWith('google/')) return true
  if (migrated.startsWith('deepseek/')) return true
  return false
}

export function resolveChatModelId(model: unknown): string {
  const trimmed = typeof model === 'string' ? model.trim() : ''
  if (trimmed && isAllowedChatModelId(trimmed)) return migrateChatModelId(trimmed)
  return DEFAULT_CHAT_MODEL_ID
}

export function resolveChatModelConfig(
  model: unknown,
  lmStudioModelId?: unknown,
  lmStudioBaseUrl?: unknown
): ChatModelConfig {
  const resolved = resolveChatModelId(model)
  if (isLmStudioRouterId(resolved)) {
    const override = typeof lmStudioModelId === 'string' ? lmStudioModelId.trim() : ''
    const modelId = override || resolveLmStudioModelId(resolved)
    const fromCtx = typeof lmStudioBaseUrl === 'string' ? lmStudioBaseUrl.trim() : ''
    const baseUrl =
      fromCtx || process.env.LM_STUDIO_BASE_URL?.trim() || DEFAULT_LM_STUDIO_BASE_URL
    return {
      id: buildLmStudioRouterId(modelId) as `${string}/${string}`,
      url: baseUrl
    }
  }
  return resolved
}

export function googleModelNameFromRouterId(routerId: string): string {
  return routerId.startsWith('google/') ? routerId.slice('google/'.length) : routerId
}

export function defaultLmStudioRouterId(): string {
  return buildLmStudioRouterId(resolveLmStudioModelId())
}
