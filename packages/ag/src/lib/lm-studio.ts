export const DEFAULT_LM_STUDIO_BASE_URL = 'http://127.0.0.1:1234/v1'

export const DEFAULT_LM_STUDIO_MODEL_ID = 'google/gemma-4-e4b'



export function normalizeLmStudioModelId(raw: string | null | undefined): string {

  const trimmed = String(raw ?? '').trim()

  return trimmed || DEFAULT_LM_STUDIO_MODEL_ID

}



export function buildLmStudioRouterId(modelId: string = DEFAULT_LM_STUDIO_MODEL_ID): string {

  return `lmstudio/${normalizeLmStudioModelId(modelId)}`

}



export function isLmStudioRouterId(modelId: string): boolean {

  return modelId.startsWith('lmstudio/')

}



export function stripLmStudioRouterPrefix(routerId: string): string {

  return routerId.startsWith('lmstudio/') ? routerId.slice('lmstudio/'.length) : routerId

}



export function resolveLmStudioModelId(routerId?: string | null): string {

  const fromEnv = process.env.LM_STUDIO_MODEL_ID?.trim()

  if (fromEnv) return normalizeLmStudioModelId(fromEnv)

  if (routerId && isLmStudioRouterId(routerId)) {

    return normalizeLmStudioModelId(stripLmStudioRouterPrefix(routerId))

  }

  return DEFAULT_LM_STUDIO_MODEL_ID

}


