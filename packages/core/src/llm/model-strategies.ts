/**
 * Shared model strategies for LedgeIndex agents.
 * Use with buildModelStrategy() from chat-model-config.ts.
 */

import {
  hasDeepSeekKey,
  hasGoogleGenerativeKey,
  hasOpenAiKey,
} from "../vector/config.js";

export interface AgentModelConfig {
  model: string;
  maxRetries: number;
}

export const GEMINI_3_5_FLASH_LITE_MODEL = "google/gemini-3.5-flash-lite";
export const GPT_5_6_LUNA_MODEL = "openai/gpt-5.6-luna";
export const DEEPSEEK_V4_FLASH_MODEL = "deepseek/deepseek-v4-flash";

/**
 * Prefer providers that have credentials configured.
 * Order: Google Flash Lite → OpenAI Luna → DeepSeek V4 Flash.
 */
export function buildKeyAwareChatModelStrategy(): AgentModelConfig[] {
  const strategy: AgentModelConfig[] = [];
  if (hasGoogleGenerativeKey()) {
    strategy.push({ model: GEMINI_3_5_FLASH_LITE_MODEL, maxRetries: 0 });
  }
  if (hasOpenAiKey()) {
    strategy.push({ model: GPT_5_6_LUNA_MODEL, maxRetries: 0 });
  }
  if (hasDeepSeekKey()) {
    strategy.push({ model: DEEPSEEK_V4_FLASH_MODEL, maxRetries: 0 });
  }
  if (strategy.length === 0) {
    strategy.push({ model: GEMINI_3_5_FLASH_LITE_MODEL, maxRetries: 0 });
  }
  return strategy;
}

/** Static fallback order (prefer Google) when env keys are not readable at import time. */
export const DEFAULT_CHAT_MODEL_STRATEGY: AgentModelConfig[] = [
  { model: GEMINI_3_5_FLASH_LITE_MODEL, maxRetries: 0 },
  { model: GPT_5_6_LUNA_MODEL, maxRetries: 0 },
  { model: DEEPSEEK_V4_FLASH_MODEL, maxRetries: 0 },
];

/** Query rewrite + coverage grader — same key-aware chain as docs chat. */
export const FAST_AUXILIARY_MODEL_STRATEGY: AgentModelConfig[] =
  DEFAULT_CHAT_MODEL_STRATEGY;
