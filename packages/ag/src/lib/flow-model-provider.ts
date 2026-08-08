export type FlowModelProviderId = 'google' | 'openai' | 'anthropic'

export const FLOW_MODEL_BY_PROVIDER: Record<FlowModelProviderId, string> = {
  google: 'google/gemini-3.5-flash-lite',
  openai: 'openai/gpt-4.1-mini',
  anthropic: 'anthropic/claude-sonnet-4-6'
}

export const DEFAULT_FLOW_MODEL = FLOW_MODEL_BY_PROVIDER.google

export function resolveFlowModel(model?: string): string {
  if (model?.trim() && model.includes('/')) return model.trim()
  return DEFAULT_FLOW_MODEL
}
