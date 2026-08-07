/** Google models that accept thinkingConfig — keep in sync with ledgeindex chat-thinking-level.ts */
export const THINKING_SUPPORTED_MODEL_LEVELS = {
  "google/gemini-3.6-flash": "medium",
  "google/gemini-3.5-flash-lite": "medium",
  "google/gemini-3.5-flash": "medium",
  "google/gemini-3.1-pro-preview": "high",
  "google/gemini-3-flash-preview": "medium",
  "google/gemini-3.1-flash-lite-preview": "medium",
} as const satisfies Record<string, "minimal" | "low" | "medium" | "high">;

export type ChatThinkingLevel = "off" | "low" | "medium" | "high" | "xhigh";

type GoogleThinkingApiLevel = "minimal" | "low" | "medium" | "high";

export function modelSupportsThinking(modelId: string): boolean {
  return modelId.trim() in THINKING_SUPPORTED_MODEL_LEVELS;
}

export function defaultThinkingLevelForModel(modelId: string): ChatThinkingLevel {
  const normalized = modelId.trim();
  const level =
    THINKING_SUPPORTED_MODEL_LEVELS[
      normalized as keyof typeof THINKING_SUPPORTED_MODEL_LEVELS
    ];
  return level ?? "off";
}

function normalizeThinkingLevel(value: unknown): ChatThinkingLevel | undefined {
  const level = String(value ?? "").trim().toLowerCase();
  if (
    level === "off" ||
    level === "low" ||
    level === "medium" ||
    level === "high" ||
    level === "xhigh"
  ) {
    return level;
  }
  return undefined;
}

function googleThinkingApiLevel(
  level: ChatThinkingLevel,
): GoogleThinkingApiLevel | null {
  if (level === "off") return null;
  if (level === "xhigh") return "high";
  return level;
}

export function resolveChatThinkingLevel(input: {
  modelId: string;
  configThinkingLevel?: unknown;
  requestContextThinkingLevel?: unknown;
  includeThoughts?: unknown;
}): ChatThinkingLevel {
  const normalized = input.modelId.trim();
  if (!modelSupportsThinking(normalized)) return "off";

  const explicit =
    normalizeThinkingLevel(input.configThinkingLevel) ??
    normalizeThinkingLevel(input.requestContextThinkingLevel);

  if (explicit) return explicit;

  if (input.includeThoughts === false) return "off";

  return defaultThinkingLevelForModel(normalized);
}

export function buildChatThinkingProviderOptions(
  modelId: string,
  level: ChatThinkingLevel,
): Record<string, Record<string, unknown>> | undefined {
  const normalized = modelId.trim();
  if (!modelSupportsThinking(normalized)) return undefined;

  const googleLevel = googleThinkingApiLevel(level);
  if (!googleLevel) {
    return {
      google: {
        thinkingConfig: {
          includeThoughts: false,
        },
      },
    };
  }

  return {
    google: {
      thinkingConfig: {
        thinkingLevel: googleLevel,
        includeThoughts: true,
      },
    },
  };
}

type ChatPostBody = {
  model?: string;
  config?: { thinkingLevel?: unknown; includeThoughts?: unknown };
  requestContext?: Record<string, unknown>;
  providerOptions?: Record<string, Record<string, unknown>>;
};

export function applyChatThinkingToBody(body: ChatPostBody): ChatPostBody {
  const modelId = String(
    body.model ?? body.requestContext?.model_id ?? "",
  ).trim();
  if (!modelId) return body;

  const thinkingLevel = resolveChatThinkingLevel({
    modelId,
    configThinkingLevel: body.config?.thinkingLevel,
    requestContextThinkingLevel: body.requestContext?.model_thinking_level,
    includeThoughts: body.config?.includeThoughts,
  });

  const thinkingProviderOptions = buildChatThinkingProviderOptions(
    modelId,
    thinkingLevel,
  );

  const includeThoughts = thinkingLevel !== "off";

  const nextBody: ChatPostBody = {
    ...body,
    config: {
      ...body.config,
      thinkingLevel,
      includeThoughts,
    },
    requestContext: {
      ...body.requestContext,
      model_id: modelId,
      model_thinking_level: thinkingLevel,
      include_thoughts: includeThoughts,
    },
  };

  if (thinkingProviderOptions) {
    nextBody.providerOptions = {
      ...body.providerOptions,
      ...thinkingProviderOptions,
      google: {
        ...body.providerOptions?.google,
        ...thinkingProviderOptions.google,
      },
    };
  }

  return nextBody;
}
