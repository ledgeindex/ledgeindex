/**
 * Speed benchmark: TTFT + tokens/sec with LM-Studio-matching settings.
 *
 *   npx tsx src/primitives/benchmark.ts
 *   npx tsx src/primitives/benchmark.ts --context 8192 --max-tokens 500 --warmup
 *   npx tsx src/primitives/benchmark.ts --model-path "C:\...\model.gguf"
 */
import { flagBool, flagNumber, flagString, parseArgs } from "../cli-args.js";
import { GEMMA4_E2B_DEFAULT_PROMPT } from "../presets/gemma4-e2b.js";
import {
  DEFAULT_CONTEXT_SIZE,
  DEFAULT_FLASH_ATTENTION,
  DEFAULT_GPU_LAYERS,
  type BenchmarkMetrics,
} from "../types.js";
import { isMainModule } from "../utils.js";
import { chatPrompt, printMetrics } from "./chat.js";
import { getStatus, mount, unmount } from "./mount.js";

export type RunBenchmarkOptions = {
  modelPath?: string;
  modelUri?: string;
  modelsDir?: string;
  contextSize?: number;
  gpuLayers?: number | "max";
  flashAttention?: boolean;
  prompt?: string;
  maxTokens?: number;
  temperature?: number;
  thoughtTokens?: number;
  warmup?: boolean;
};

export type RunBenchmarkResult = {
  modelPath: string;
  text: string;
  metrics: BenchmarkMetrics;
};

export async function runBenchmark(options: RunBenchmarkOptions = {}): Promise<RunBenchmarkResult> {
  const runtime = await mount({
    modelPath: options.modelPath,
    modelUri: options.modelUri,
    modelsDir: options.modelsDir,
    contextSize: options.contextSize ?? DEFAULT_CONTEXT_SIZE,
    gpuLayers: options.gpuLayers ?? DEFAULT_GPU_LAYERS,
    flashAttention: options.flashAttention ?? DEFAULT_FLASH_ATTENTION,
  });

  if (options.warmup) {
    await chatPrompt({
      prompt: "Say hi in one sentence.",
      maxTokens: 32,
      temperature: 0.2,
      thoughtTokens: 0,
      autoDisposeSequence: true,
    });
  }

  const { text, metrics } = await chatPrompt({
    prompt: options.prompt ?? GEMMA4_E2B_DEFAULT_PROMPT,
    maxTokens: options.maxTokens ?? 500,
    temperature: options.temperature ?? 0.7,
    thoughtTokens: options.thoughtTokens ?? 0,
    autoDisposeSequence: true,
  });

  return { modelPath: runtime.modelPath, text, metrics };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const contextSize = flagNumber(args, "context", DEFAULT_CONTEXT_SIZE);
  const maxTokens = flagNumber(args, "max-tokens", 500);
  const temperature = flagNumber(args, "temperature", 0.7);
  const thoughtTokens = flagNumber(args, "thought-tokens", 0);
  const gpuLayers = flagNumber(args, "gpu-layers", DEFAULT_GPU_LAYERS);
  const warmup = flagBool(args, "warmup", false);
  const prompt = flagString(args, "prompt", GEMMA4_E2B_DEFAULT_PROMPT);
  const modelPath = flagString(args, "model-path", "") || undefined;
  const modelUri = flagString(args, "uri", "") || undefined;

  console.log(`Loading model (gpuLayers=${gpuLayers}, context=${contextSize}, flashAttention=true)...`);

  const result = await runBenchmark({
    modelPath,
    modelUri,
    contextSize,
    gpuLayers,
    flashAttention: true,
    prompt,
    maxTokens,
    temperature,
    thoughtTokens,
    warmup,
  });

  const status = getStatus();
  console.log(`Model path : ${result.modelPath}`);
  if (status.mounted) {
    console.log(`gpuLayers  : ${status.gpuLayers}`);
    console.log(`context    : ${status.contextSize}`);
    console.log(`flashAttn  : ${status.flashAttention}`);
  }
  console.log(`\nPrompt: ${prompt}\n`);
  console.log("--- Response ---");
  console.log(result.text);
  printMetrics(result.metrics);

  await unmount();
}

if (isMainModule(import.meta.url)) {
  main().catch(async (error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
