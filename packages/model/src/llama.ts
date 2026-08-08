import { getLlama, type Llama } from "node-llama-cpp";
import type { GpuOption } from "./types.js";

/**
 * A process-wide `Llama` binding instance is shared across primitives (inspect / estimate / mount)
 * since node-llama-cpp only needs (and expects) a single binding to be initialized per process.
 */
let llamaPromise: Promise<Llama> | undefined;
let llamaGpuOption: GpuOption | undefined;

export async function getSharedLlama(gpu: GpuOption = "auto"): Promise<Llama> {
  if (!llamaPromise || llamaGpuOption !== gpu) {
    llamaGpuOption = gpu;
    llamaPromise = getLlama({ gpu });
  }
  return llamaPromise;
}

export async function disposeSharedLlama(): Promise<void> {
  if (!llamaPromise) return;
  const promise = llamaPromise;
  llamaPromise = undefined;
  llamaGpuOption = undefined;
  const llama = await promise;
  await llama.dispose();
}

/** Create a standalone (non-shared) `Llama` binding instance. */
export async function createLlamaEngine(gpu: GpuOption = "auto"): Promise<Llama> {
  return getLlama({ gpu });
}

export type { Llama };
