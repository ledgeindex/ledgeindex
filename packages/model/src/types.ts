import type { Llama, LlamaContext, LlamaContextSequence, LlamaGpuType, LlamaModel } from "node-llama-cpp";

/** LM Studio's load dialog for large local GGUFs uses these knobs. */
export const DEFAULT_CONTEXT_SIZE = 131_072;
export const DEFAULT_GPU_LAYERS = 35;
export const DEFAULT_FLASH_ATTENTION = true;
/** Parallel chat slots in one mounted context (node-llama-cpp `sequences`). */
export const DEFAULT_SEQUENCES = 2;
/** Hard cap for a single AG native mount. */
export const MAX_SEQUENCES = 2;

export const DEFAULT_SERVE_PORT = 8787;
export const DEFAULT_SERVE_HOST = "127.0.0.1";

/** `getLlama({ gpu })` accepts `"auto"` plus every concrete `LlamaGpuType` (which already includes `false`). */
export type GpuOption = "auto" | LlamaGpuType;

export type ReasoningEffort = "off" | "low" | "medium" | "high";

export type MountSettings = {
  /** Absolute path to a local `.gguf` file. Wins over `modelUri` when both are set. */
  modelPath?: string;
  /** A node-llama-cpp model URI (e.g. `hf:org/repo:QUANT`), resolved/downloaded on demand. */
  modelUri?: string;
  /** Directory used to store/resolve models downloaded from `modelUri`. */
  modelsDir?: string;
  contextSize?: number;
  gpuLayers?: number | "max";
  flashAttention?: boolean;
  /**
   * Max concurrent chat completions (context sequences).
   * Higher values use more KV-cache memory for the same context size.
   */
  sequences?: number;
  gpu?: GpuOption;
};

export type ResolvedMountSettings = {
  modelPath: string;
  contextSize: number;
  gpuLayers: number | "max";
  flashAttention: boolean;
  sequences: number;
  gpu: GpuOption;
};

export type MountedRuntime = {
  llama: Llama;
  modelPath: string;
  model: LlamaModel;
  context: LlamaContext;
  settings: ResolvedMountSettings;
};

export type MountStatus =
  | { mounted: false }
  | {
      mounted: true;
      modelPath: string;
      contextSize: number;
      gpuLayers: number;
      flashAttention: boolean;
      sequences: number;
      gpu: string;
    };

export type ChatSequence = LlamaContextSequence;

export type BenchmarkMetrics = {
  ttftMs: number;
  tokenCount: number;
  tokensPerSec: number;
  totalDurationSec: number;
  generationDurationSec: number;
};

export type LmStudioModelDescriptor = {
  /** Stable id — the POSIX-style path of the model file relative to its scan root, without the `.gguf` extension. */
  id: string;
  /** File name without the `.gguf` extension. */
  name: string;
  /** Absolute path to the `.gguf` file. */
  path: string;
  bytes: number;
  /** Quantization label parsed from the file name (e.g. `Q4_K_M`, `Q8_0`, `F16`), when detectable. */
  quant?: string;
  /** Model family/repo, derived from the containing folder structure, when detectable. */
  family?: string;
  /** Absolute path to a sibling `mmproj-*.gguf` (vision projector) file, when present. */
  mmprojPath?: string;
};

export type DiscoverLmStudioOptions = {
  /** Override the default `~/.lmstudio/models` root(s) to scan. */
  roots?: string[];
};
