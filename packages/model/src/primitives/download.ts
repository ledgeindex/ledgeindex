/**
 * Download a GGUF model from Hugging Face (or resolve one already on disk).
 *
 *   npx tsx src/primitives/download.ts
 *   npx tsx src/primitives/download.ts --uri hf:org/repo:QUANT --dir ./models
 *
 * Env: HF_TOKEN / HUGGING_FACE_HUB_TOKEN for gated repos.
 */
import fs from "node:fs";
import path from "node:path";
import { createModelDownloader, resolveModelFile } from "node-llama-cpp";
import { flagString, parseArgs } from "../cli-args.js";
import { GEMMA4_E2B_MODEL_URI } from "../presets/gemma4-e2b.js";
import { formatBytes, hfTokenFromEnv, isMainModule } from "../utils.js";

export type DownloadProgress = { downloadedSize: number; totalSize: number };

export type DownloadOptions = {
  modelUri?: string;
  modelsDir: string;
  onProgress?: (progress: DownloadProgress) => void;
};

export type DownloadResult = { modelPath: string; bytes: number };

export async function downloadModel(options: DownloadOptions): Promise<DownloadResult> {
  const modelUri = options.modelUri ?? GEMMA4_E2B_MODEL_URI;
  const modelsDir = path.resolve(options.modelsDir);
  fs.mkdirSync(modelsDir, { recursive: true });

  const token = hfTokenFromEnv();
  const downloader = await createModelDownloader({
    modelUri,
    dirPath: modelsDir,
    showCliProgress: false,
    tokens: token ? { huggingFace: token } : undefined,
    onProgress: options.onProgress,
  });

  const modelPath = await downloader.download();
  const bytes = fs.existsSync(modelPath) ? fs.statSync(modelPath).size : 0;
  return { modelPath, bytes };
}

export type ResolveOrDownloadOptions = {
  modelPath?: string;
  modelUri?: string;
  modelsDir?: string;
  /** `"auto"` (default) downloads a missing model; `false` requires it to already be local. */
  download?: "auto" | false;
};

/** Resolve an explicit local model path, or resolve/download a model URI into `modelsDir`. */
export async function resolveOrDownloadModel(options: ResolveOrDownloadOptions): Promise<string> {
  if (options.modelPath) {
    const absolute = path.resolve(options.modelPath);
    if (!fs.existsSync(absolute)) {
      throw new Error(`Model file not found: ${absolute}`);
    }
    return absolute;
  }

  if (!options.modelsDir) {
    throw new Error("resolveOrDownloadModel requires modelsDir when modelPath is not set");
  }

  const modelsDir = path.resolve(options.modelsDir);
  fs.mkdirSync(modelsDir, { recursive: true });
  const modelUri = options.modelUri ?? GEMMA4_E2B_MODEL_URI;
  const tokens = hfTokenFromEnv();

  return resolveModelFile(modelUri, {
    directory: modelsDir,
    download: options.download ?? "auto",
    tokens: tokens ? { huggingFace: tokens } : undefined,
  });
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const modelUri = flagString(args, "uri", GEMMA4_E2B_MODEL_URI);
  const modelsDir = path.resolve(flagString(args, "dir", path.join(process.cwd(), "models")));

  console.log(`Model URI : ${modelUri}`);
  console.log(`Target dir: ${modelsDir}`);
  console.log(`HF token  : ${hfTokenFromEnv() ? "set" : "not set"}`);

  const result = await downloadModel({
    modelUri,
    modelsDir,
    onProgress({ totalSize, downloadedSize }) {
      if (!totalSize) return;
      const percent = ((downloadedSize / totalSize) * 100).toFixed(1);
      process.stdout.write(
        `\rDownloading: ${percent}% (${formatBytes(downloadedSize)} / ${formatBytes(totalSize)})`,
      );
    },
  });

  process.stdout.write("\n");
  console.log(`Done: ${result.modelPath}`);
  console.log(`Size: ${formatBytes(result.bytes)}`);
}

if (isMainModule(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
