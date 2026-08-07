import type { Mastra } from "@mastra/core/mastra";

let mastraInstance: Mastra | null = null;

export function setMastraInstance(instance: Mastra): void {
  mastraInstance = instance;
}

export function getMastra(): Mastra {
  if (!mastraInstance) {
    throw new Error(
      "LedgeIndex Mastra is not initialized — start @ledgeindex/server with docs profile first",
    );
  }
  return mastraInstance;
}

export function tryGetMastra(): Mastra | null {
  return mastraInstance;
}
