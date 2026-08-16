import { createLedgeIndex, type LedgeIndex } from "@ledgeindex/sdk";
import { resolveConfig, type LedgeIndexCliConfig } from "./config.js";

export const CLI_USER_ID = "ledgeindex-cli-local";

let instance: LedgeIndex | null = null;

/** Wire env, data dir, and in-process Mastra — no HTTP server. */
export async function initCliRuntime(
  rawConfig: LedgeIndexCliConfig,
): Promise<LedgeIndex> {
  const resolved = resolveConfig(rawConfig);
  instance = await createLedgeIndex({
    dataDir: resolved.dataDir,
    localUserId: CLI_USER_ID,
    keys: resolved.keys,
    provider: resolved.provider,
  });
  return instance;
}

export function getCliInstance(): LedgeIndex {
  if (!instance) {
    throw new Error("CLI runtime not initialized");
  }
  return instance;
}
