export const GEMINI_3_5_FLASH_LITE_MODEL_ID = "google/gemini-3.5-flash-lite";
export const GPT_5_6_LUNA_MODEL_ID = "openai/gpt-5.6-luna";
export const DEEPSEEK_V4_FLASH_MODEL_ID = "deepseek/deepseek-v4-flash";

export type ChatModelProviderId = "google" | "openai" | "deepseek";

export const LEDGEINDEX_CHAT_MODELS = [
  {
    id: GEMINI_3_5_FLASH_LITE_MODEL_ID,
    label: "Gemini 3.5 Flash Lite",
    provider: "google" as const,
  },
  {
    id: GPT_5_6_LUNA_MODEL_ID,
    label: "GPT-5.6 Luna",
    provider: "openai" as const,
  },
  {
    id: DEEPSEEK_V4_FLASH_MODEL_ID,
    label: "DeepSeek V4 Flash",
    provider: "deepseek" as const,
  },
] as const;

export type LedgeIndexChatModelId =
  (typeof LEDGEINDEX_CHAT_MODELS)[number]["id"];

export type LedgeIndexChatModel = (typeof LEDGEINDEX_CHAT_MODELS)[number];

export const DEFAULT_CHAT_MODEL_ID = GEMINI_3_5_FLASH_LITE_MODEL_ID;

export type ChatProviderKeyStatus = Partial<
  Record<ChatModelProviderId, boolean>
>;

/** Models whose provider key is present. Empty when none are set. */
export function filterChatModelsByProviderKeys(
  keys: ChatProviderKeyStatus | null | undefined,
): LedgeIndexChatModel[] {
  if (!keys) return [...LEDGEINDEX_CHAT_MODELS];
  return LEDGEINDEX_CHAT_MODELS.filter((model) => Boolean(keys[model.provider]));
}

export function pickDefaultChatModelId(
  models: readonly LedgeIndexChatModel[],
  preferred?: string | null,
): LedgeIndexChatModelId {
  if (preferred && models.some((model) => model.id === preferred)) {
    return preferred as LedgeIndexChatModelId;
  }
  return (models[0]?.id ?? DEFAULT_CHAT_MODEL_ID) as LedgeIndexChatModelId;
}
