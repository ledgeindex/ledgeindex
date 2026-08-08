/**
 * Recommended local GGUFs for AutomationGhost / LedgeIndex mount.
 *
 * Roles:
 * - qwen-0.8b — fast summaries
 * - qwen-4b — balanced local chat
 * - qwen-9b — data extraction
 * - e2b — Gemma 4 E2B light
 * - e4b — Gemma 4 E4B allrounder
 * - 12b-qat — Gemma 4 12B decision making
 */
export type LocalMountableKey =
  | "qwen-0.8b"
  | "qwen-4b"
  | "qwen-9b"
  | "e2b"
  | "e4b"
  | "12b-qat";

/** Chat template strategy for OpenAI-compatible serve. */
export type LocalMountableChatFamily = "gemma4" | "auto";

export type LocalMountablePreset = {
  key: LocalMountableKey;
  /** Short UI label */
  label: string;
  /** OpenAI /v1 model id advertised by local serve */
  serveModelId: string;
  /** Hugging Face URI for download when missing from disk */
  modelUri: string;
  /** Match LM Studio path/name (case-insensitive) */
  pathPattern: RegExp;
  /** Prefer this quant when multiple GGUFs match */
  preferredQuantPattern: RegExp;
  /** Gemma 4 needs an explicit wrapper for reasoning channels; others use auto. */
  chatFamily: LocalMountableChatFamily;
};

export const LOCAL_MOUNTABLES: readonly LocalMountablePreset[] = [
  {
    key: "qwen-0.8b",
    label: "Qwen3.5 0.8B · summaries · speed",
    serveModelId: "qwen3.5-0.8b",
    modelUri: "hf:lmstudio-community/Qwen3.5-0.8B-GGUF:Q8_0",
    pathPattern: /Qwen3\.5-0\.8B/i,
    preferredQuantPattern: /Q8_0/i,
    chatFamily: "auto",
  },
  {
    key: "qwen-4b",
    label: "Qwen3.5 4B · balanced",
    serveModelId: "qwen3.5-4b",
    modelUri: "hf:lmstudio-community/Qwen3.5-4B-GGUF:Q4_K_M",
    pathPattern: /Qwen3\.5-4B/i,
    preferredQuantPattern: /Q4_K_M/i,
    chatFamily: "auto",
  },
  {
    key: "qwen-9b",
    label: "Qwen3.5 9B · extraction · accuracy",
    serveModelId: "qwen3.5-9b",
    modelUri: "hf:lmstudio-community/Qwen3.5-9B-GGUF:Q4_K_M",
    pathPattern: /Qwen3\.5-9B/i,
    preferredQuantPattern: /Q4_K_M/i,
    chatFamily: "auto",
  },
  {
    key: "e2b",
    label: "Gemma 4 E2B · light",
    serveModelId: "gemma-4-e2b-q4_k_m",
    modelUri: "hf:lmstudio-community/gemma-4-E2B-it-GGUF:Q4_K_M",
    pathPattern: /gemma-4-E2B-it/i,
    preferredQuantPattern: /Q4_K_M/i,
    chatFamily: "gemma4",
  },
  {
    key: "e4b",
    label: "Gemma 4 E4B · allrounder",
    serveModelId: "gemma-4-e4b-q4_k_m",
    modelUri: "hf:lmstudio-community/gemma-4-E4B-it-GGUF:Q4_K_M",
    pathPattern: /gemma-4-E4B-it/i,
    preferredQuantPattern: /Q4_K_M/i,
    chatFamily: "gemma4",
  },
  {
    key: "12b-qat",
    label: "Gemma 4 12B QAT · decisions",
    serveModelId: "gemma-4-12b-qat-q4_0",
    modelUri: "hf:lmstudio-community/gemma-4-12B-it-QAT-GGUF:Q4_0",
    pathPattern: /gemma-4-12B-it-QAT/i,
    preferredQuantPattern: /Q4_0/i,
    chatFamily: "gemma4",
  },
] as const;

export function findLocalMountable(key: string): LocalMountablePreset | undefined {
  return LOCAL_MOUNTABLES.find((entry) => entry.key === key);
}

export function isLocalMountableKey(value: string): value is LocalMountableKey {
  return LOCAL_MOUNTABLES.some((entry) => entry.key === value);
}

/** @deprecated use LocalMountableKey */
export type Gemma4MountableKey = Extract<LocalMountableKey, "e2b" | "e4b" | "12b-qat">;
/** @deprecated use LocalMountablePreset */
export type Gemma4MountablePreset = LocalMountablePreset;
/** @deprecated use LOCAL_MOUNTABLES */
export const GEMMA4_MOUNTABLES = LOCAL_MOUNTABLES;
/** @deprecated use findLocalMountable */
export const findGemma4Mountable = findLocalMountable;
/** @deprecated use isLocalMountableKey */
export const isGemma4MountableKey = isLocalMountableKey;
