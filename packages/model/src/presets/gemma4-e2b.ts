import { DEFAULT_CONTEXT_SIZE, DEFAULT_FLASH_ATTENTION, DEFAULT_GPU_LAYERS, type MountSettings } from "../types.js";

export const GEMMA4_E2B_MODEL_URI = "hf:lmstudio-community/gemma-4-E2B-it-GGUF:Q4_K_M";
export const GEMMA4_E2B_MODEL_ID = "gemma-4-e2b-q4_k_m";

export const GEMMA4_E2B_DEFAULT_PROMPT =
  "Write a detailed explanation of quantum computing in 3 paragraphs.";

/** LM-Studio-matching mount settings for the Gemma 4 E2B Instruct Q4_K_M GGUF. */
export const GEMMA4_E2B_MOUNT_SETTINGS: MountSettings = {
  modelUri: GEMMA4_E2B_MODEL_URI,
  contextSize: DEFAULT_CONTEXT_SIZE,
  gpuLayers: DEFAULT_GPU_LAYERS,
  flashAttention: DEFAULT_FLASH_ATTENTION,
};
