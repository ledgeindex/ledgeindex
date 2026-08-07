// @ts-nocheck
import type { MastraLanguageModel } from "@mastra/core/agent";
import {
  getGoogleGenerativeApiKey,
  hasDeepSeekKey,
  hasGoogleGenerativeKey,
  hasOpenAiKey,
} from "../vector/config.js";
import { getModelObject } from "./model-utils.js";

/** Matches AutomationGhost Brain catalog id + Google API model id. */
export const GEMMA_4_31B_CATALOG_ID = "google/gemma-4-31b-it";
export const GEMMA_4_31B_API_MODEL_ID = "gemma-4-31b-it";
export const GEMMA_4_31B_LM_STUDIO_ID = "google/gemma-4-31b-it";

/** Default LM Studio id for page example enrichment (Coder 7B). */
export const DEFAULT_ENRICH_LM_STUDIO_ID = "qwen2.5-coder-7b-instruct";

/** Cheap OpenAI enrich fallback (override via LEDGEINDEX_ENRICH_MODEL). */
export const DEFAULT_ENRICH_OPENAI_ID = "openai/gpt-5.6-luna";

/** Google enrich fallback. */
export const DEFAULT_ENRICH_GOOGLE_ID = "google/gemini-3.5-flash-lite";

/** DeepSeek enrich / chat fallback. */
export const DEFAULT_ENRICH_DEEPSEEK_ID = "deepseek/deepseek-v4-flash";

export type LedgeIndexLlmBackend = "api" | "lmstudio" | "openai" | "deepseek";

export type LedgeIndexLlmModel = MastraLanguageModel;

function normalizeCloudModelId(raw: string, defaultProvider = "google"): string {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;
  if (trimmed.includes("/")) return trimmed;
  return `${defaultProvider}/${trimmed}`;
}

/**
 * Mastra knows openai/google string ids; DeepSeek must be an OpenAI-compatible
 * LanguageModel instance (see getModelObject).
 */
function resolveCloudMastraModel(raw: string): LedgeIndexLlmModel {
  const id = raw.trim();
  if (!id) return id;
  if (id.startsWith("lmstudio/")) {
    return buildLmStudioMastraModel(id);
  }
  if (id.startsWith("deepseek/")) {
    return getModelObject(id) as unknown as LedgeIndexLlmModel;
  }
  return id;
}

function modelSetupLabel(model: LedgeIndexLlmModel): string {
  if (typeof model === "string") return model;
  if (model && typeof model === "object") {
    const record = model as { id?: unknown; modelId?: unknown };
    if (typeof record.id === "string" && record.id.trim()) return record.id;
    if (typeof record.modelId === "string" && record.modelId.trim()) {
      return record.modelId;
    }
  }
  return "unknown";
}

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

/** Native LM Studio models API (loaded_instances), not OpenAI /v1/models. */
function lmStudioNativeModelsUrl(baseUrl = getLmStudioBaseUrl()): string {
  const origin = normalizeLmStudioBaseUrl(baseUrl).replace(/\/v1\/?$/, "");
  return `${origin}/api/v1/models`;
}

let lmStudioActiveModelCache: { at: number; modelId: string | null } | null =
  null;
const LM_STUDIO_ACTIVE_CACHE_MS = 2_500;
let lmStudioActiveProbeInFlight: Promise<string | null> | null = null;

function listLoadedLmStudioModelIds(body: unknown): string[] {
  if (!body || typeof body !== "object") return [];
  const models = (body as { models?: unknown }).models;
  if (!Array.isArray(models)) return [];

  const ids: string[] = [];
  for (const raw of models) {
    if (!raw || typeof raw !== "object") continue;
    const model = raw as {
      key?: unknown;
      loaded_instances?: Array<{ id?: unknown }>;
    };
    const key = String(model.key ?? "").trim();
    const instances = model.loaded_instances;
    if (!Array.isArray(instances) || instances.length === 0) continue;
    for (const instance of instances) {
      const id = String(instance?.id ?? key).trim();
      if (id) ids.push(id);
    }
  }
  return ids;
}

/** Last probed LM Studio loaded model id (may be null / stale). */
export function getCachedLmStudioActiveModelId(): string | null {
  return lmStudioActiveModelCache?.modelId ?? null;
}

/**
 * Probe LM Studio for the model currently loaded in VRAM.
 * Prefer this over hardcoded catalog ids — /v1/models lists disk models, not active.
 */
export async function probeLmStudioActiveModelId(
  timeoutMs = 1500,
): Promise<string | null> {
  const now = Date.now();
  if (
    lmStudioActiveModelCache &&
    now - lmStudioActiveModelCache.at < LM_STUDIO_ACTIVE_CACHE_MS
  ) {
    return lmStudioActiveModelCache.modelId;
  }
  if (lmStudioActiveProbeInFlight) return lmStudioActiveProbeInFlight;

  lmStudioActiveProbeInFlight = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(lmStudioNativeModelsUrl(), {
        signal: controller.signal,
      });
      if (!res.ok) {
        lmStudioActiveModelCache = { at: Date.now(), modelId: null };
        return null;
      }
      const body = await res.json();
      const ids = listLoadedLmStudioModelIds(body);
      const modelId = ids[0] ?? null;
      lmStudioActiveModelCache = { at: Date.now(), modelId };
      return modelId;
    } catch {
      lmStudioActiveModelCache = { at: Date.now(), modelId: null };
      return null;
    } finally {
      clearTimeout(timer);
      lmStudioActiveProbeInFlight = null;
    }
  })();

  return lmStudioActiveProbeInFlight;
}

/**
 * Sync LM Studio model id: env override, else last probed active model.
 * Does not hardcode Gemma — call resolveLmStudioModelId() when you need a probe.
 */
export function getLmStudioModelId(): string {
  return (
    process.env.LM_STUDIO_MODEL_ID?.trim() ||
    process.env.LEDGEINDEX_LM_STUDIO_MODEL_ID?.trim() ||
    getCachedLmStudioActiveModelId() ||
    ""
  );
}

/**
 * Resolve the LM Studio model to call: env → currently loaded model.
 * Throws if LM Studio is up but nothing is loaded (and no env override).
 */
export async function resolveLmStudioModelId(): Promise<string> {
  const explicit =
    process.env.LM_STUDIO_MODEL_ID?.trim() ||
    process.env.LEDGEINDEX_LM_STUDIO_MODEL_ID?.trim();
  if (explicit) return explicit;

  const active = await probeLmStudioActiveModelId();
  if (active) return active;

  throw new Error(
    "LM Studio has no loaded model. Load a model in LM Studio, or set LM_STUDIO_MODEL_ID.",
  );
}

export function isLmStudioConfigured(): boolean {
  return Boolean(process.env.LM_STUDIO_BASE_URL?.trim());
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

export function buildLmStudioMastraModel(
  modelId: string,
  baseUrl?: string,
): LedgeIndexLlmModel {
  const normalized = modelId.replace(/^lmstudio\//, "").trim();
  return {
    id: `lmstudio/${normalized}`,
    url: baseUrl ? normalizeLmStudioBaseUrl(baseUrl) : getLmStudioBaseUrl(),
  } as LedgeIndexLlmModel;
}

/** Build enrich model from crawl-review resume / workflow state. */
export function resolveEnrichModelFromSelection(selection: {
  backend?: string | null;
  modelId?: string | null;
  baseUrl?: string | null;
  googleModelId?: string | null;
} | null | undefined): LedgeIndexLlmModel | undefined {
  if (!selection?.backend) return undefined;
  const backend = selection.backend.toLowerCase();

  if (backend === "api" || backend === "google" || backend === "deepseek" || backend === "openai" || backend === "anthropic") {
    const google = selection.googleModelId?.trim();
    if (google) {
      return resolveCloudMastraModel(normalizeCloudModelId(google));
    }
    if (backend === "deepseek" && hasDeepSeekKey()) {
      return resolveCloudMastraModel(DEFAULT_ENRICH_DEEPSEEK_ID);
    }
    if (backend === "openai" && hasOpenAiKey()) {
      return resolveCloudMastraModel(DEFAULT_ENRICH_OPENAI_ID);
    }
    if (backend === "anthropic") {
      return "anthropic/claude-sonnet-4-6";
    }
    if (hasGoogleGenerativeKey()) {
      return resolveCloudMastraModel(DEFAULT_ENRICH_GOOGLE_ID);
    }
    if (hasDeepSeekKey()) {
      return resolveCloudMastraModel(DEFAULT_ENRICH_DEEPSEEK_ID);
    }
    if (hasOpenAiKey()) {
      return resolveCloudMastraModel(DEFAULT_ENRICH_OPENAI_ID);
    }
    return undefined;
  }

  if (backend === "lm-studio" || backend === "lmstudio" || backend === "ag-native") {
    const modelId = selection.modelId?.trim();
    const baseUrl = selection.baseUrl?.trim();
    if (!modelId || !baseUrl) return undefined;
    return buildLmStudioMastraModel(modelId, baseUrl);
  }

  return undefined;
}

/**
 * Pruner / classify model — defaults to GPT-5.6 Luna when OpenAI, else Gemini 3.5 Flash Lite.
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
          "LM Studio model unknown — load a model in LM Studio, set LM_STUDIO_MODEL_ID, or wait for active-model probe.",
        );
      }
      return buildLmStudioMastraModel(id);
    }
    case "openai":
      return resolveCloudMastraModel("openai/gpt-5.6-luna");
    case "deepseek":
      return resolveCloudMastraModel(DEFAULT_ENRICH_DEEPSEEK_ID);
    case "api":
    default:
      if (hasGoogleGenerativeKey()) {
        return resolveCloudMastraModel("google/gemini-3.5-flash-lite");
      }
      if (hasDeepSeekKey()) {
        return resolveCloudMastraModel(DEFAULT_ENRICH_DEEPSEEK_ID);
      }
      if (hasOpenAiKey()) {
        return resolveCloudMastraModel("openai/gpt-5.6-luna");
      }
      return GEMMA_4_31B_CATALOG_ID;
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
    return resolveCloudMastraModel(process.env.LEDGEINDEX_GENERATOR_MODEL.trim());
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
    return resolveCloudMastraModel(DEFAULT_ENRICH_DEEPSEEK_ID);
  }
  if (hasOpenAiKey()) {
    return resolveCloudMastraModel("openai/gpt-5.6-luna");
  }

  return getClassifyModel();
}

export function resolveEnrichBackend(): LedgeIndexLlmBackend {
  const explicit = process.env.LEDGEINDEX_ENRICH_BACKEND?.toLowerCase();
  if (
    explicit === "lmstudio" ||
    explicit === "api" ||
    explicit === "openai" ||
    explicit === "deepseek"
  ) {
    return explicit;
  }

  // Prefer cloud API keys (same order as chat / profile). LM Studio is opt-in
  // via LEDGEINDEX_ENRICH_BACKEND=lmstudio or when no cloud keys are present.
  if (hasGoogleGenerativeKey()) return "api";
  if (hasDeepSeekKey()) return "deepseek";
  if (hasOpenAiKey()) return "openai";
  if (isLmStudioConfigured()) return "lmstudio";
  return "api";
}

export function getEnrichLmStudioModelId(): string {
  return (
    process.env.LEDGEINDEX_ENRICH_LM_STUDIO_MODEL_ID?.trim() ||
    process.env.LM_STUDIO_MODEL_ID?.trim() ||
    process.env.LEDGEINDEX_LM_STUDIO_MODEL_ID?.trim() ||
    getCachedLmStudioActiveModelId() ||
    ""
  );
}

/**
 * Example enrichment model.
 * Prefer cloud keys; LM Studio uses the active loaded model (or env override).
 */
export function getEnrichModel(): LedgeIndexLlmModel {
  if (process.env.LEDGEINDEX_ENRICH_MODEL?.trim()) {
    return resolveCloudMastraModel(process.env.LEDGEINDEX_ENRICH_MODEL.trim());
  }

  switch (resolveEnrichBackend()) {
    case "lmstudio": {
      const id = getEnrichLmStudioModelId();
      if (!id) {
        throw new Error(
          "LM Studio model unknown — load a model in LM Studio or set LEDGEINDEX_ENRICH_LM_STUDIO_MODEL_ID.",
        );
      }
      return buildLmStudioMastraModel(id);
    }
    case "openai":
      return resolveCloudMastraModel(DEFAULT_ENRICH_OPENAI_ID);
    case "deepseek":
      return resolveCloudMastraModel(DEFAULT_ENRICH_DEEPSEEK_ID);
    case "api":
    default:
      if (hasDeepSeekKey()) {
        return resolveCloudMastraModel(DEFAULT_ENRICH_DEEPSEEK_ID);
      }
      if (hasOpenAiKey()) {
        return resolveCloudMastraModel(DEFAULT_ENRICH_OPENAI_ID);
      }
      if (hasGoogleGenerativeKey()) {
        return resolveCloudMastraModel(DEFAULT_ENRICH_GOOGLE_ID);
      }
      {
        const id = getEnrichLmStudioModelId();
        if (!id) {
          throw new Error(
            "No LLM configured for enrich (cloud keys or LM Studio loaded model).",
          );
        }
        return buildLmStudioMastraModel(id);
      }
  }
}

/** True when enrich can call an LLM (explicit model override, LM Studio, or cloud keys). */
export function hasEnrichLlm(modelOverride?: LedgeIndexLlmModel): boolean {
  if (modelOverride) return true;
  if (process.env.LEDGEINDEX_ENRICH_MODEL?.trim()) return true;
  return hasLlmKey();
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
    prunerModel = modelSetupLabel(getPrunerModel());
  } catch {
    prunerModel =
      getLmStudioModelId() ||
      (isLmStudioConfigured() ? "lmstudio/(no loaded model)" : "unset");
  }
  try {
    generatorModel = modelSetupLabel(getGeneratorModel());
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
