import { mkdir } from "node:fs/promises";
import { Mastra } from "@mastra/core/mastra";
import { createDocsMastraContribution } from "@ledgeindex/docs";
import { setMastraInstance } from "@ledgeindex/docs/runtime/mastra/instance.js";
import {
  applyOptionsToProcessEnv,
  validateOptions,
} from "./resolve-options.js";
import type { ResolvedLedgeIndexOptions } from "./types.js";

let initialized = false;
let activeOptions: ResolvedLedgeIndexOptions | null = null;

function buildDocsMastra(): Mastra {
  const contribution = createDocsMastraContribution();
  if (!contribution.storage) {
    throw new Error("Docs Mastra contribution is missing storage");
  }

  return new Mastra({
    agents: contribution.agents ?? {},
    workflows: contribution.workflows ?? {},
    vectors: contribution.vectors ?? {},
    mcpServers: contribution.mcpServers ?? {},
    storage: contribution.storage,
    logger: contribution.logger,
    observability: contribution.observability,
    server: contribution.server,
  } as ConstructorParameters<typeof Mastra>[0]);
}

export async function initRuntime(
  resolved: ResolvedLedgeIndexOptions,
): Promise<void> {
  validateOptions(resolved);
  applyOptionsToProcessEnv(resolved);
  await mkdir(resolved.dataDir, { recursive: true });

  if (!initialized) {
    setMastraInstance(buildDocsMastra());
    initialized = true;
  }

  activeOptions = resolved;
}

export function getActiveOptions(): ResolvedLedgeIndexOptions {
  if (!activeOptions) {
    throw new Error("LedgeIndex runtime not initialized. Call createLedgeIndex() first.");
  }
  return activeOptions;
}

export function getLocalUserId(): string {
  return getActiveOptions().localUserId;
}
