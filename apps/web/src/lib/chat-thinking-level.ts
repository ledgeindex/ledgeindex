/**
 * Google models that accept thinkingConfig — mirrors Pindown
 * `frontend/src/lib/chat-model-options.ts` CHAT_MODEL_THINKING_LEVELS.
 */
export const THINKING_SUPPORTED_MODEL_LEVELS = {
  "google/gemini-3.6-flash": "medium",
  "google/gemini-3.5-flash-lite": "medium",
  "google/gemini-3.5-flash": "medium",
  "google/gemini-3.1-pro-preview": "high",
  "google/gemini-3-flash-preview": "medium",
  "google/gemini-3.1-flash-lite-preview": "medium",
} as const satisfies Record<string, "minimal" | "low" | "medium" | "high">;

export type ThinkingSupportedModelId =
  keyof typeof THINKING_SUPPORTED_MODEL_LEVELS;

/** Reasoning effort for UI overrides (dev page). */
export type ChatThinkingLevel = "off" | "low" | "medium" | "high" | "xhigh";

export const CHAT_THINKING_LEVEL_OPTIONS: ReadonlyArray<{
  value: ChatThinkingLevel;
  label: string;
}> = [
  { value: "off", label: "Off" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "xhigh", label: "Extra high" },
];

type GoogleThinkingApiLevel = "minimal" | "low" | "medium" | "high";

export function modelSupportsThinking(modelId: string): boolean {
  return modelId.trim() in THINKING_SUPPORTED_MODEL_LEVELS;
}

export function defaultThinkingLevelForModel(
  modelId: string,
): ChatThinkingLevel {
  const normalized = modelId.trim();
  const level =
    THINKING_SUPPORTED_MODEL_LEVELS[
      normalized as ThinkingSupportedModelId
    ];
  return level ?? "off";
}

function googleThinkingApiLevel(
  level: ChatThinkingLevel,
): GoogleThinkingApiLevel | null {
  if (level === "off") return null;
  if (level === "xhigh") return "high";
  return level;
}

export function includeThoughtsForLevel(
  modelId: string,
  level: ChatThinkingLevel,
): boolean {
  if (!modelSupportsThinking(modelId)) return false;
  return level !== "off";
}

/**
 * Only send thinkingConfig for supported Gemini models with thinking enabled.
 * Gemma and other models must not receive thinkingConfig at all.
 */
export function buildChatThinkingProviderOptions(
  modelId: string,
  level: ChatThinkingLevel,
): Record<string, Record<string, unknown>> | undefined {
  const normalized = modelId.trim();
  if (!modelSupportsThinking(normalized)) return undefined;

  const googleLevel = googleThinkingApiLevel(level);
  if (!googleLevel) return undefined;

  return {
    google: {
      thinkingConfig: {
        thinkingLevel: googleLevel,
        includeThoughts: true,
      },
    },
  };
}

export type ChatThinkingTransportExtras = {
  config?: {
    thinkingLevel: ChatThinkingLevel;
    includeThoughts: boolean;
  };
  providerOptions?: Record<string, Record<string, unknown>>;
  requestContext: {
    model_thinking_level?: ChatThinkingLevel;
    include_thoughts?: boolean;
  };
};

export function buildChatThinkingTransportExtras(
  modelId: string,
  level: ChatThinkingLevel,
): ChatThinkingTransportExtras {
  const normalized = modelId.trim();
  const supportsThinking = modelSupportsThinking(normalized);
  const includeThoughts = includeThoughtsForLevel(normalized, level);
  const providerOptions = buildChatThinkingProviderOptions(normalized, level);

  if (!supportsThinking || level === "off") {
    return { requestContext: {} };
  }

  return {
    config: {
      thinkingLevel: level,
      includeThoughts,
    },
    ...(providerOptions ? { providerOptions } : {}),
    requestContext: {
      model_thinking_level: level,
      include_thoughts: includeThoughts,
    },
  };
}

export const DEFAULT_CHAT_THINKING_LEVEL: ChatThinkingLevel = "off";

/** Default level for transport when caller does not override (Gemini → model default). */
export function resolveChatThinkingLevel(
  modelId: string,
  level?: ChatThinkingLevel,
): ChatThinkingLevel {
  if (level !== undefined) return level;
  if (modelSupportsThinking(modelId)) {
    return defaultThinkingLevelForModel(modelId);
  }
  return DEFAULT_CHAT_THINKING_LEVEL;
}

export function thinkingLevelFromDeepThinking(
  enabled: boolean,
  modelId: string,
): ChatThinkingLevel {
  if (!enabled || !modelSupportsThinking(modelId)) return "off";
  return defaultThinkingLevelForModel(modelId);
}
