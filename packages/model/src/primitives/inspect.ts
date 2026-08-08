/**
 * Pre-flight GPU / Node / bindings check.
 *
 *   npx tsx src/primitives/inspect.ts
 */
import { disposeSharedLlama, getSharedLlama } from "../llama.js";
import type { GpuOption } from "../types.js";
import { formatBytes, hfTokenFromEnv, isMainModule } from "../utils.js";

export type EnvironmentInfo = {
  node: string;
  platform: NodeJS.Platform;
  arch: string;
  hfTokenPresent: boolean;
  gpu: string;
  supportsGpuOffloading: boolean;
  cpuMathCores: number;
  vram: { free: number; total: number; used: number };
  buildType: string;
  llamaCppRelease: { repo: string; release: string };
  systemInfo: string;
  warnings: string[];
};

export type InspectOptions = {
  gpu?: GpuOption;
};

export async function inspectEnvironment(options: InspectOptions = {}): Promise<EnvironmentInfo> {
  const llama = await getSharedLlama(options.gpu ?? "auto");
  const vram = await llama.getVramState();
  const warnings: string[] = [];

  if (llama.gpu === false || !llama.supportsGpuOffloading) {
    warnings.push("GPU offloading unavailable — expect CPU-only speeds (far below LM Studio CUDA).");
  } else if (String(llama.gpu).toLowerCase() !== "cuda" && process.platform === "win32") {
    warnings.push(
      `GPU backend is "${String(llama.gpu)}" (not cuda). On Windows+NVIDIA, CUDA usually matches LM Studio best.`,
    );
  }

  return {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    hfTokenPresent: hfTokenFromEnv() !== undefined,
    gpu: String(llama.gpu),
    supportsGpuOffloading: llama.supportsGpuOffloading,
    cpuMathCores: llama.cpuMathCores,
    vram: { free: vram.free, total: vram.total, used: vram.used },
    buildType: llama.buildType,
    llamaCppRelease: { repo: llama.llamaCppRelease.repo, release: llama.llamaCppRelease.release },
    systemInfo: llama.systemInfo,
    warnings,
  };
}

async function main(): Promise<void> {
  const info = await inspectEnvironment();

  console.log(`Node       : ${info.node}`);
  console.log(`Platform   : ${info.platform} ${info.arch}`);
  console.log(`HF token   : ${info.hfTokenPresent ? "set" : "not set"}`);
  console.log(`GPU backend: ${info.gpu}`);
  console.log(`GPU offload: ${info.supportsGpuOffloading ? "yes" : "no"}`);
  console.log(`CPU cores  : ${info.cpuMathCores}`);
  console.log(
    `VRAM       : free ${formatBytes(info.vram.free)} / total ${formatBytes(info.vram.total)} (used ${formatBytes(info.vram.used)})`,
  );
  console.log(`Build type : ${info.buildType}`);
  console.log(`llama.cpp  : ${info.llamaCppRelease.repo}@${info.llamaCppRelease.release}`);
  console.log(`systemInfo : ${info.systemInfo}`);

  for (const warning of info.warnings) {
    console.warn(`\nWARNING: ${warning}`);
  }
  if (info.warnings.length === 0) {
    console.log("\nGPU looks usable for a fair LM Studio comparison.");
  }

  await disposeSharedLlama();
}

if (isMainModule(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
