export type ProviderId = 'openai' | 'google' | 'deepseek'

export const PROVIDERS: {
  id: ProviderId
  label: string
  envVar: string
  placeholder: string
  hint: string
}[] = [
  {
    id: 'openai',
    label: 'OpenAI',
    envVar: 'OPENAI_API_KEY',
    placeholder: 'sk-...',
    hint: 'GPT models — platform.openai.com'
  },
  {
    id: 'google',
    label: 'Gemini',
    envVar: 'GOOGLE_GENERATIVE_AI_API_KEY',
    placeholder: 'AIza...',
    hint: 'Gemini models — Google AI Studio (also accepts GOOGLE_API_KEY)'
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    envVar: 'DEEPSEEK_API_KEY',
    placeholder: 'sk-...',
    hint: 'DeepSeek models — platform.deepseek.com'
  }
]

export const PROVIDER_IDS: ProviderId[] = PROVIDERS.map((p) => p.id)

export type ProviderKeyInput = Partial<Record<ProviderId, string>>

export type ProviderKeyStatus = Record<ProviderId, boolean>

export function emptyProviderKeyStatus(): ProviderKeyStatus {
  return {
    openai: false,
    google: false,
    deepseek: false
  }
}
