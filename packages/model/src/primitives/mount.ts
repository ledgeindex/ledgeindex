/**
 * Singleton mounted model runtime. Loads a GGUF model + context once per process,
 * matching LM Studio's speed knobs (contextSize / gpuLayers / flashAttention).
 */
import path from "node:path";
import { getSharedLlama } from "../llama.js";
import {
  DEFAULT_CONTEXT_SIZE,
  DEFAULT_FLASH_ATTENTION,
  DEFAULT_GPU_LAYERS,
  DEFAULT_SEQUENCES,
  MAX_SEQUENCES,
  type MountedRuntime,
  type MountSettings,
  type MountStatus,
} from "../types.js";
import { resolveOrDownloadModel } from "./download.js";

let mountedRuntime: MountedRuntime | undefined;
let mountingPromise: Promise<MountedRuntime> | undefined;

function resolveSequences(raw: number | undefined): number {
  if (typeof raw === "number" && Number.isFinite(raw) && raw >= 1) {
    return Math.min(MAX_SEQUENCES, Math.floor(raw));
  }
  return DEFAULT_SEQUENCES;
}

/**
 * Mount (load) a model + context. Idempotent: if a model is already mounted, it is returned
 * as-is — call `unmount()` first to swap models or settings.
 */
export async function mount(settings: MountSettings = {}): Promise<MountedRuntime> {
  if (mountedRuntime) return mountedRuntime;
  if (mountingPromise) return mountingPromise;

  mountingPromise = (async (): Promise<MountedRuntime> => {
    const gpu = settings.gpu ?? "auto";
    const gpuLayers = settings.gpuLayers ?? DEFAULT_GPU_LAYERS;
    const contextSize = settings.contextSize ?? DEFAULT_CONTEXT_SIZE;
    const flashAttention = settings.flashAttention ?? DEFAULT_FLASH_ATTENTION;
    const sequences = resolveSequences(settings.sequences);

    const llama = await getSharedLlama(gpu);
    const modelPath = await resolveOrDownloadModel({
      modelPath: settings.modelPath,
      modelUri: settings.modelUri,
      modelsDir: settings.modelsDir ?? path.join(process.cwd(), "models"),
    });

    const model = await llama.loadModel({ modelPath, gpuLayers });
    const context = await model.createContext({
      contextSize,
      flashAttention,
      sequences,
    });

    const runtime: MountedRuntime = {
      llama,
      modelPath,
      model,
      context,
      settings: {
        modelPath,
        contextSize: context.contextSize,
        gpuLayers: model.gpuLayers,
        flashAttention,
        sequences,
        gpu,
      },
    };

    mountedRuntime = runtime;
    return runtime;
  })();

  try {
    return await mountingPromise;
  } finally {
    mountingPromise = undefined;
  }
}

export async function unmount(): Promise<void> {
  const runtime = mountedRuntime;
  mountedRuntime = undefined;
  if (!runtime) return;

  await runtime.context.dispose();
  await runtime.model.dispose();
}

export function getMountedRuntime(): MountedRuntime | undefined {
  return mountedRuntime;
}

export function getStatus(): MountStatus {
  if (!mountedRuntime) return { mounted: false };
  const { settings } = mountedRuntime;
  return {
    mounted: true,
    modelPath: settings.modelPath,
    contextSize: settings.contextSize,
    gpuLayers: typeof settings.gpuLayers === "number" ? settings.gpuLayers : -1,
    flashAttention: settings.flashAttention,
    sequences: settings.sequences,
    gpu: String(settings.gpu),
  };
}
