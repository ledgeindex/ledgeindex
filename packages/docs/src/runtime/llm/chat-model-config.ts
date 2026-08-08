import {
  GEMMA_4_31B_CATALOG_ID,
  buildLmStudioMastraModel,
} from "./models.js";
import type { MastraLanguageModel } from "@mastra/core/agent";
import type { LanguageModel } from "ai";
import { getModelObject } from "./model-utils.js";
import { mastraLanguageModel } from "./mastra-model.js";
import {
  buildKeyAwareChatModelStrategy,
  type AgentModelConfig,
} from "./model-strategies.js";

export const GEMINI_3_5_FLASH_LITE_CATALOG_ID = "google/gemini-3.5-flash-lite";
export const GEMMA_4_26B_CATALOG_ID = "google/gemma-4-26b-a4b-it";
export const GPT_5_6_LUNA_CATALOG_ID = "openai/gpt-5.6-luna";
export const GPT_5_4_MINI_CATALOG_ID = "openai/gpt-5.4-mini";
export const O3_MINI_CATALOG_ID = "openai/o3-mini";
export const DEEPSEEK_V4_FLASH_CATALOG_ID = "deepseek/deepseek-v4-flash";

export const LEDGEINDEX_CHAT_MODELS = [
  {
    id: GEMINI_3_5_FLASH_LITE_CATALOG_ID,
    label: "Gemini 3.5 Flash Lite",
  },
  { id: GPT_5_6_LUNA_CATALOG_ID, label: "GPT-5.6 Luna" },
  { id: DEEPSEEK_V4_FLASH_CATALOG_ID, label: "DeepSeek V4 Flash" },
  { id: GPT_5_4_MINI_CATALOG_ID, label: "GPT-5.4 Mini" },
  { id: O3_MINI_CATALOG_ID, label: "o3-mini" },
  { id: GEMMA_4_31B_CATALOG_ID, label: "Gemma 4 31B" },
  { id: GEMMA_4_26B_CATALOG_ID, label: "Gemma 4 26B A4B" },
] as const;

export type MastraModelWithRetries = {
  model: LanguageModel;
  maxRetries: number;
};

export function buildModelStrategy(
  strategy: AgentModelConfig[],
): MastraModelWithRetries[] {
  return strategy.map((config) => ({
    model: getModelObject(config.model),
    maxRetries: config.maxRetries,
  }));
}

function resolveEnvOverrideModel(raw: string): MastraLanguageModel {
  if (raw.startsWith("lmstudio/")) {
    return buildLmStudioMastraModel(raw);
  }
  if (raw.startsWith("deepseek/")) {
    return getModelObject(raw) as unknown as MastraLanguageModel;
  }
  return mastraLanguageModel(raw);
}

/** Primary model id for retrieval meta (rewrite / coverage labels). */
export function primaryAuxiliaryModelId(): string {
  const override = process.env.LEDGEINDEX_REWRITE_MODEL?.trim();
  if (override) return override.replace(/^lmstudio\//, "");
  return buildKeyAwareChatModelStrategy()[0]!.model;
}

/**
 * Fast auxiliary steps (query rewrite, coverage grader).
 * Gemini 3.5 Flash Lite when Google key is set; OpenAI / DeepSeek when configured.
 */
export function resolveRewriteModelConfig():
  | MastraLanguageModel
  | MastraModelWithRetries[] {
  const override = process.env.LEDGEINDEX_REWRITE_MODEL?.trim();
  if (override) return resolveEnvOverrideModel(override);
  return buildModelStrategy(buildKeyAwareChatModelStrategy());
}

/**
 * Resolve chat model from Mastra requestContext.
 * Explicit model_id (UI) wins; otherwise default strategy with API fallbacks.
 */
export function resolveChatModelConfig(
  modelId: unknown,
  lmStudioModelId?: unknown,
): MastraLanguageModel | MastraModelWithRetries[] {
  const raw =
    typeof modelId === "string" && modelId.trim().length > 0
      ? modelId.trim()
      : undefined;

  if (raw?.startsWith("lmstudio/")) {
    return buildLmStudioMastraModel(raw);
  }

  // Mastra model router does not know `deepseek/` — use OpenAI-compatible client.
  if (raw?.startsWith("deepseek/")) {
    return getModelObject(raw) as unknown as MastraLanguageModel;
  }

  if (raw) {
    return mastraLanguageModel(raw);
  }

  const generatorOverride = process.env.LEDGEINDEX_GENERATOR_MODEL?.trim();
  if (generatorOverride) {
    return resolveEnvOverrideModel(generatorOverride);
  }

  return buildModelStrategy(buildKeyAwareChatModelStrategy());
}
