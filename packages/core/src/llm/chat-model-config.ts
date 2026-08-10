// @ts-nocheck
import type { MastraLanguageModel } from "@mastra/core/agent";
import type { LanguageModel } from "ai";
import {
  GEMMA_4_31B_CATALOG_ID,
  buildLmStudioMastraModel,
  getCachedLmStudioActiveModelId,
  isLmStudioConfigured,
  resolveLmStudioModelId,
} from "./models.js";
import { getModelObject } from "./model-utils.js";
import {
  buildKeyAwareChatModelStrategy,
  type AgentModelConfig,
} from "./model-strategies.js";
import {
  hasDeepSeekKey,
  hasGoogleGenerativeKey,
  hasOpenAiKey,
} from "../vector/config.js";

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
    return getModelObject(raw);
  }
  return raw;
}

function readRequestModelId(
  requestContext?: { get?: (key: string) => unknown },
): string | undefined {
  const raw = requestContext?.get?.("model_id");
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Primary model id for retrieval meta (rewrite / coverage labels). */
export function primaryAuxiliaryModelId(
  requestContext?: { get?: (key: string) => unknown },
): string {
  const override = process.env.LEDGEINDEX_REWRITE_MODEL?.trim();
  if (override) return override;

  const selected = readRequestModelId(requestContext);
  if (selected) return selected;

  return resolveDefaultProfileModelIdSync();
}

/**
 * Sync default (cloud keys / cached LM Studio active model). Prefer the async
 * resolver before profile runs so LM Studio is probed for the loaded model.
 */
export function resolveDefaultProfileModelIdSync(): string {
  const override = process.env.LEDGEINDEX_PROFILE_MODEL?.trim();
  if (override) return override;

  if (hasGoogleGenerativeKey() || hasOpenAiKey() || hasDeepSeekKey()) {
    return buildKeyAwareChatModelStrategy()[0]!.model;
  }

  const cached = getCachedLmStudioActiveModelId();
  if (cached) return `lmstudio/${cached}`;

  return GEMINI_3_5_FLASH_LITE_CATALOG_ID;
}

/**
 * Default model for profile / catalog pick / docs-identity.
 * Prefer cloud keys (Gemini → OpenAI → DeepSeek); else probe LM Studio's
 * currently loaded model (no hardcoded Gemma id).
 */
export async function resolveDefaultProfileModelId(): Promise<string> {
  const override = process.env.LEDGEINDEX_PROFILE_MODEL?.trim();
  if (override) return override;

  if (hasGoogleGenerativeKey() || hasOpenAiKey() || hasDeepSeekKey()) {
    return buildKeyAwareChatModelStrategy()[0]!.model;
  }

  if (isLmStudioConfigured()) {
    const active = await resolveLmStudioModelId();
    return `lmstudio/${active}`;
  }

  return GEMINI_3_5_FLASH_LITE_CATALOG_ID;
}

/**
 * Query rewrite + coverage grader.
 * Prefer the chat UI's selected model_id; env LEDGEINDEX_REWRITE_MODEL still wins.
 */
export function resolveRewriteModelConfig(
  requestContext?: { get?: (key: string) => unknown },
): MastraLanguageModel | MastraModelWithRetries[] {
  const override = process.env.LEDGEINDEX_REWRITE_MODEL?.trim();
  if (override) return resolveEnvOverrideModel(override);

  const selected = readRequestModelId(requestContext);
  if (selected) {
    return resolveChatModelConfig(
      selected,
      requestContext?.get?.("lm_studio_model_id"),
    );
  }

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

  if (raw?.startsWith("deepseek/")) {
    return getModelObject(raw);
  }

  if (raw) {
    return raw;
  }

  const generatorOverride = process.env.LEDGEINDEX_GENERATOR_MODEL?.trim();
  if (generatorOverride) {
    return resolveEnvOverrideModel(generatorOverride);
  }

  return buildModelStrategy(buildKeyAwareChatModelStrategy());
}
