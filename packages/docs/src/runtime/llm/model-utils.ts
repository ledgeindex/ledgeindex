import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { LanguageModel } from "ai";
import { getGoogleGenerativeApiKey } from "../vector/config.js";

const DEEPSEEK_BASE_URL = "https://api.deepseek.com/v1";

function openaiClient() {
  return createOpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });
}

function googleClient() {
  return createGoogleGenerativeAI({
    apiKey: getGoogleGenerativeApiKey(),
  });
}

/** DeepSeek is OpenAI-compatible; Mastra/AI SDK have no native `deepseek/` provider. */
function deepseekClient() {
  return createOpenAI({
    apiKey: process.env.DEEPSEEK_API_KEY,
    baseURL: DEEPSEEK_BASE_URL,
    name: "deepseek",
  });
}

export const google = googleClient();

/**
 * Get a model instance from a model string (e.g. "openai/gpt-5.6-luna").
 */
export function getModelObject(modelString: string): LanguageModel {
  const [provider, modelId] = modelString.split("/");
  if (!provider || !modelId) {
    throw new Error(`Invalid model string: ${modelString}`);
  }

  switch (provider) {
    case "openai":
      return openaiClient()(modelId);
    case "google":
      return googleClient()(modelId) as unknown as LanguageModel;
    case "deepseek":
      return deepseekClient()(modelId);
    default:
      throw new Error(
        `Unknown provider: ${provider}. Supported: openai, google, deepseek`,
      );
  }
}
