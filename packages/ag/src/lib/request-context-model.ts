import { resolveChatModelId, googleModelNameFromRouterId } from './chat-models'

export function readModelIdFromContext(context: unknown): string | undefined {
  const ctx = context as {
    requestContext?: { get?: (key: string) => unknown; registry?: { get?: (key: string) => unknown } }
  }
  const requestContext = ctx?.requestContext
  if (!requestContext) return undefined

  const read = (key: string): unknown =>
    requestContext.get?.(key) ?? requestContext.registry?.get?.(key)

  const modelId = String(read('model_id') ?? '').trim()
  if (modelId) return resolveChatModelId(modelId)

  const provider = String(read('provider_id') ?? '').trim().toLowerCase()
  const modelName = String(read('model_name') ?? '').trim()
  if (provider === 'google' && modelName) {
    return resolveChatModelId(`google/${modelName}`)
  }

  return undefined
}

export function resolveGoogleGeminiModelId(context: unknown, fallbackGeminiName: string): string {
  const fromCtx = readModelIdFromContext(context)
  if (fromCtx) return googleModelNameFromRouterId(fromCtx)
  return fallbackGeminiName
}
