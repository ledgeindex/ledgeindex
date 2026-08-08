/**
 * Score how well a GGUF model fits the current hardware, and recommend mount settings.
 *
 *   npx tsx src/primitives/estimate.ts --model-path "C:\...\model.gguf"
 *   npx tsx src/primitives/estimate.ts --uri hf:org/repo:QUANT
 */
import { GgufInsights, readGgufFileInfo, type Llama } from "node-llama-cpp";
import { flagBool, flagNumber, flagString, parseArgs } from "../cli-args.js";
import { disposeSharedLlama, getSharedLlama } from "../llama.js";
import {
  DEFAULT_CONTEXT_SIZE,
  DEFAULT_FLASH_ATTENTION,
  DEFAULT_GPU_LAYERS,
  type GpuOption,
} from "../types.js";
import { hfTokenFromEnv, isMainModule } from "../utils.js";

export type EstimateOptions = {
  targetGpuLayers?: number | "max";
  targetContextSize?: number;
  flashAttention?: boolean;
  gpu?: GpuOption;
};

export type EstimateResourceUsage = {
  modelRamUsage: number;
  contextRamUsage: number;
  totalRamUsage: number;
  modelVramUsage: number;
  contextVramUsage: number;
  totalVramUsage: number;
};

export type EstimateResult = {
  modelPath: string;
  trainContextSize: number | undefined;
  totalLayers: number;
  modelSizeBytes: number;
  flashAttentionSupported: boolean;
  compatibilityScore: number;
  bonusScore: number;
  totalScore: number;
  recommended: {
    gpuLayers: number;
    contextSize: number;
    useMmap: boolean;
  };
  resourceUsage: EstimateResourceUsage;
  warnings: string[];
};

type InsightsCacheEntry = {
  insights: GgufInsights;
  llama: Llama;
};

/** Reuse parsed GGUF insights so slider re-estimates stay cheap. */
const insightsCache = new Map<string, InsightsCacheEntry>();

async function loadInsights(
  modelPathOrUri: string,
  gpu: GpuOption,
): Promise<InsightsCacheEntry> {
  const cacheKey = `${gpu}::${modelPathOrUri}`;
  const cached = insightsCache.get(cacheKey);
  if (cached) return cached;

  const llama = await getSharedLlama(gpu);
  const tokens = hfTokenFromEnv();
  const ggufFileInfo = await readGgufFileInfo(modelPathOrUri, {
    tokens: tokens ? { huggingFace: tokens } : undefined,
  });
  const insights = await GgufInsights.from(ggufFileInfo, llama);
  const entry = { insights, llama };
  insightsCache.set(cacheKey, entry);
  return entry;
}

/** Drop cached insights (e.g. after unmount / worker recycle). */
export function clearEstimateInsightsCache(): void {
  insightsCache.clear();
}

/** Estimate the best mount settings for a local GGUF file or downloadable model URI. */
export async function estimate(modelPathOrUri: string, options: EstimateOptions = {}): Promise<EstimateResult> {
  const gpu = options.gpu ?? "auto";
  const { insights } = await loadInsights(modelPathOrUri, gpu);
  const warnings = insights.getWarnings(modelPathOrUri);

  const scored = await insights.configurationResolver.resolveAndScoreConfig({
    targetGpuLayers: options.targetGpuLayers ?? DEFAULT_GPU_LAYERS,
    targetContextSize: options.targetContextSize ?? DEFAULT_CONTEXT_SIZE,
    flashAttention: options.flashAttention ?? DEFAULT_FLASH_ATTENTION,
  });

  return {
    modelPath: modelPathOrUri,
    trainContextSize: insights.trainContextSize,
    totalLayers: insights.totalLayers,
    modelSizeBytes: insights.modelSize,
    flashAttentionSupported: insights.flashAttentionSupported,
    compatibilityScore: scored.compatibilityScore,
    bonusScore: scored.bonusScore,
    totalScore: scored.totalScore,
    recommended: {
      gpuLayers: scored.resolvedValues.gpuLayers,
      contextSize: scored.resolvedValues.contextSize,
      useMmap: scored.resolvedValues.useMmap,
    },
    resourceUsage: {
      modelRamUsage: scored.resolvedValues.modelRamUsage,
      contextRamUsage: scored.resolvedValues.contextRamUsage,
      totalRamUsage: scored.resolvedValues.totalRamUsage,
      modelVramUsage: scored.resolvedValues.modelVramUsage,
      contextVramUsage: scored.resolvedValues.contextVramUsage,
      totalVramUsage: scored.resolvedValues.totalVramUsage,
    },
    warnings,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const modelPath = flagString(args, "model-path", "");
  const modelUri = flagString(args, "uri", "");
  const target = modelPath || modelUri;
  if (!target) {
    throw new Error("estimate requires --model-path <file> or --uri <hf:...>");
  }

  const result = await estimate(target, {
    targetGpuLayers: flagNumber(args, "gpu-layers", DEFAULT_GPU_LAYERS),
    targetContextSize: flagNumber(args, "context", DEFAULT_CONTEXT_SIZE),
    flashAttention: flagBool(args, "flash-attention", DEFAULT_FLASH_ATTENTION),
  });

  console.log(JSON.stringify(result, null, 2));

  await disposeSharedLlama();
}

if (isMainModule(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
