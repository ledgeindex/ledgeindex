import type { MastraLanguageModel } from "@mastra/core/agent";

type LmStudioMastraModelConfig = {
  id: string;
  url: string;
};

/**
 * Mastra agents accept provider/model string ids at runtime; the published
 * MastraLanguageModel union is narrower than runtime.
 */
export function mastraLanguageModel(modelId: string): MastraLanguageModel {
  return modelId as unknown as MastraLanguageModel;
}

export function mastraLanguageModelFromLmStudio(
  config: LmStudioMastraModelConfig,
): MastraLanguageModel {
  return config as unknown as MastraLanguageModel;
}

export function mastraModelIdLabel(model: MastraLanguageModel): string {
  if (typeof model === "string") return model;

  const record = model as unknown as {
    id?: string;
    modelId?: string;
  };
  if (typeof record.id === "string" && record.id.trim()) return record.id;
  if (typeof record.modelId === "string" && record.modelId.trim()) {
    return record.modelId;
  }

  return "unknown";
}
