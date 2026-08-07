import type { MastraLanguageModel } from "@mastra/core/agent";
import {
  mastraLanguageModel,
  mastraLanguageModelFromLmStudio,
  mastraModelIdLabel,
} from "./mastra-model.js";
import { getModelObject } from "./model-utils.js";
import {
  getGoogleGenerativeApiKey,
  hasDeepSeekKey,
  hasGoogleGenerativeKey,
  hasOpenAiKey,
} from "../vector/config.js";

/** Matches AutomationGhost Brain catalog id + Google API model id. */
export const GEMMA_4_31B_CATALOG_ID = "google/gemma-4-31b-it";
export const GEMMA_4_31B_API_MODEL_ID = "gemma-4-31b-it";
export const GEMMA_4_31B_LM_STUDIO_ID = "google/gemma-4-31b-it";

export const DEEPSEEK_V4_FLASH_MODEL_ID = "deepseek/deepseek-v4-flash";

export type LedgeIndexLlmBackend = "api" | "lmstudio" | "openai" | "deepseek";

export type LedgeIndexLlmModel = MastraLanguageModel;

function normalizeLmStudioBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!trimmed) return "http://127.0.0.1:1234/v1";
  return trimmed.endsWith("/v1") ? trimmed : `${trimmed}/v1`;
}

export function getLmStudioBaseUrl(): string {
  return normalizeLmStudioBaseUrl(
    process.env.LM_STUDIO_BASE_URL ?? "http://127.0.0.1:1234/v1",
  );
}

export function getLmStudioModelId(): string {
  return (
    process.env.LM_STUDIO_MODEL_ID?.trim() ||
    process.env.LEDGEINDEX_LM_STUDIO_MODEL_ID?.trim() ||
    ""
  );
}

export function isLmStudioConfigured(): boolean {
  return Boolean(process.env.LM_STUDIO_BASE_URL?.trim());
}

function resolveCloudMastraModel(raw: string): LedgeIndexLlmModel {
  const id = raw.trim();
  if (id.startsWith("lmstudio/")) {
    return buildLmStudioMastraModel(id);
  }
  if (id.startsWith("deepseek/")) {
    return getModelObject(id) as unknown as LedgeIndexLlmModel;
  }
  return mastraLanguageModel(id);
}

export function resolvePrunerBackend(): LedgeIndexLlmBackend {
  const explicit = process.env.LEDGEINDEX_PRUNER_BACKEND?.toLowerCase();
  if (
    explicit === "lmstudio" ||
    explicit === "api" ||
    explicit === "openai" ||
    explicit === "deepseek"
  ) {
    return explicit;
  }

  if (hasGoogleGenerativeKey()) return "api";
  if (isLmStudioConfigured()) return "lmstudio";
  if (hasDeepSeekKey()) return "deepseek";
  if (hasOpenAiKey()) return "openai";
  return "api";
}

export function buildLmStudioMastraModel(modelId: string): LedgeIndexLlmModel {
  const normalized = modelId.replace(/^lmstudio\//, "").trim();
  return mastraLanguageModelFromLmStudio({
    id: `lmstudio/${normalized}`,
    url: getLmStudioBaseUrl(),
  });
}

/**
 * Pruner / classify model — defaults to GPT-5.6 Luna, then Gemini 3.5 Flash Lite.
 */
export function getPrunerModel(): LedgeIndexLlmModel {
  if (process.env.LEDGEINDEX_PRUNER_MODEL?.trim()) {
    return resolveCloudMastraModel(process.env.LEDGEINDEX_PRUNER_MODEL.trim());
  }

  switch (resolvePrunerBackend()) {
    case "lmstudio": {
      const id = getLmStudioModelId();
      if (!id) {
        throw new Error(
          "LM Studio model unknown — load a model in LM Studio or set LM_STUDIO_MODEL_ID.",
        );
      }
      return buildLmStudioMastraModel(id);
    }
    case "openai":
      return resolveCloudMastraModel("openai/gpt-5.6-luna");
    case "deepseek":
      return resolveCloudMastraModel(DEEPSEEK_V4_FLASH_MODEL_ID);
    case "api":
    default:
      if (hasGoogleGenerativeKey()) {
        return resolveCloudMastraModel("google/gemini-3.5-flash-lite");
      }
      if (hasDeepSeekKey()) {
        return resolveCloudMastraModel(DEEPSEEK_V4_FLASH_MODEL_ID);
      }
      if (hasOpenAiKey()) return resolveCloudMastraModel("openai/gpt-5.6-luna");
      return resolveCloudMastraModel(GEMMA_4_31B_CATALOG_ID);
  }
}

/** Future classify-step — same default as pruner for now. */
export function getClassifyModel(): LedgeIndexLlmModel {
  if (process.env.LEDGEINDEX_CLASSIFY_MODEL?.trim()) {
    return resolveCloudMastraModel(process.env.LEDGEINDEX_CLASSIFY_MODEL.trim());
  }
  return getPrunerModel();
}

/** Chat generator — defaults to key-aware strategy; override via LEDGEINDEX_GENERATOR_MODEL. */
export function getGeneratorModel(): LedgeIndexLlmModel {
  if (process.env.LEDGEINDEX_GENERATOR_MODEL?.trim()) {
    return resolveCloudMastraModel(
      process.env.LEDGEINDEX_GENERATOR_MODEL.trim(),
    );
  }

  return getPrunerModel();
}

/** Fast model for query rewrite (pre-step). Override via LEDGEINDEX_REWRITE_MODEL. */
export function getRewriteModel(): LedgeIndexLlmModel {
  if (process.env.LEDGEINDEX_REWRITE_MODEL?.trim()) {
    return resolveCloudMastraModel(process.env.LEDGEINDEX_REWRITE_MODEL.trim());
  }

  if (hasGoogleGenerativeKey()) {
    return resolveCloudMastraModel("google/gemini-3.5-flash-lite");
  }
  if (hasDeepSeekKey()) {
    return resolveCloudMastraModel(DEEPSEEK_V4_FLASH_MODEL_ID);
  }
  if (hasOpenAiKey()) return resolveCloudMastraModel("openai/gpt-5.6-luna");

  return getClassifyModel();
}

export function hasLlmKey(): boolean {
  return (
    hasGoogleGenerativeKey() ||
    hasOpenAiKey() ||
    hasDeepSeekKey() ||
    isLmStudioConfigured()
  );
}

export function describeLlmSetup(): {
  prunerBackend: LedgeIndexLlmBackend;
  prunerModel: string;
  generatorModel: string;
  googleKey: boolean;
  openaiKey: boolean;
  deepseekKey: boolean;
  lmStudio: boolean;
} {
  let prunerModel = "unset";
  let generatorModel = "unset";
  try {
    prunerModel = mastraModelIdLabel(getPrunerModel());
  } catch {
    prunerModel =
      getLmStudioModelId() ||
      (isLmStudioConfigured() ? "lmstudio/(no loaded model)" : "unset");
  }
  try {
    generatorModel = mastraModelIdLabel(getGeneratorModel());
  } catch {
    generatorModel = prunerModel;
  }
  return {
    prunerBackend: resolvePrunerBackend(),
    prunerModel,
    generatorModel,
    googleKey: Boolean(getGoogleGenerativeApiKey()),
    openaiKey: hasOpenAiKey(),
    deepseekKey: hasDeepSeekKey(),
    lmStudio: isLmStudioConfigured(),
  };
}
