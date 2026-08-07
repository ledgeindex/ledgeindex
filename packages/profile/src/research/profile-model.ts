import type { CrawlUrlFilterModelSelection } from "@ledgeindex/core/crawl/crawl-url-filter.js";
import { resolveEnrichModelFromSelection } from "@ledgeindex/core";
import {
  resolveChatModelConfig,
  resolveDefaultProfileModelId,
} from "@ledgeindex/core/llm/chat-model-config.js";
import type { MastraLanguageModel } from "@mastra/core/agent";

export type ProfileModelSelection = CrawlUrlFilterModelSelection;

export function normalizeProfileModelSelection(input: {
  model?: ProfileModelSelection | null;
  backend?: string | null;
  modelId?: string | null;
  baseUrl?: string | null;
  googleModelId?: string | null;
}): ProfileModelSelection | null {
  if (input.model?.backend?.trim()) {
    return input.model;
  }
  if (input.backend?.trim()) {
    return {
      backend: input.backend,
      modelId: input.modelId ?? undefined,
      baseUrl: input.baseUrl ?? undefined,
      googleModelId: input.googleModelId ?? undefined,
    };
  }
  return null;
}

export async function resolveProfileStepModel(input: {
  model?: ProfileModelSelection | null;
  /** Legacy catalog id (lmstudio/… or google/…). */
  modelId?: string;
}): Promise<{ model: MastraLanguageModel; modelId: string }> {
  const selection = input.model?.backend?.trim() ? input.model : null;
  const fromSelection = resolveEnrichModelFromSelection(selection);
  if (fromSelection) {
    const modelId =
      typeof fromSelection === "string"
        ? fromSelection
        : selection?.googleModelId?.trim() ||
          selection?.modelId?.trim() ||
          "custom";
    return { model: fromSelection, modelId };
  }

  const modelId = input.modelId?.trim() || (await resolveDefaultProfileModelId());
  return {
    model: resolveChatModelConfig(modelId) as MastraLanguageModel,
    modelId,
  };
}
