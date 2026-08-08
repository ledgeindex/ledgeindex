/**
 * Vercel AI SDK wrappers pointed at the local OpenAI-compatible server (see `./serve.js`).
 *
 * Usage:
 *   # terminal 1
 *   npx tsx src/primitives/serve.ts --model-path "C:\...\model.gguf"
 *   # terminal 2 (or same process, if `start()` was already called)
 *   import { generateLocalText } from "@ledgeindex/model/ai-sdk";
 */
import { createOpenAI, type OpenAIProvider } from "@ai-sdk/openai";
import { generateObject, generateText, streamText } from "ai";
import type { z } from "zod";
import { GEMMA4_E2B_MODEL_ID } from "../presets/gemma4-e2b.js";
import { DEFAULT_SERVE_HOST, DEFAULT_SERVE_PORT } from "../types.js";
import { getBaseURL } from "./serve.js";

export type LocalModelOptions = {
  /** Defaults to the running local server's base URL, or `http://127.0.0.1:8787/v1`. */
  baseURL?: string;
  modelId?: string;
  apiKey?: string;
  name?: string;
};

function defaultBaseURL(): string {
  return getBaseURL() ?? `http://${DEFAULT_SERVE_HOST}:${DEFAULT_SERVE_PORT}/v1`;
}

/** Create an `@ai-sdk/openai` provider pointed at the local node-llama-cpp server. */
export function createLocalModelClient(options: LocalModelOptions = {}): OpenAIProvider {
  return createOpenAI({
    baseURL: options.baseURL ?? defaultBaseURL(),
    apiKey: options.apiKey ?? "local",
    name: options.name ?? "local-node-llama-cpp",
  });
}

/** Alias of {@link createLocalModelClient}. */
export const createLocalOpenAI = createLocalModelClient;

function resolveLocalModel(options: LocalModelOptions) {
  const provider = createLocalModelClient(options);
  return provider.chat(options.modelId ?? GEMMA4_E2B_MODEL_ID);
}

export type GenerateLocalTextOptions = LocalModelOptions &
  Omit<Parameters<typeof generateText>[0], "model">;

export async function generateLocalText(options: GenerateLocalTextOptions) {
  const { baseURL, modelId, apiKey, name, ...rest } = options;
  const model = resolveLocalModel({ baseURL, modelId, apiKey, name });
  return generateText({ model, ...rest } as Parameters<typeof generateText>[0]);
}

export type StreamLocalTextOptions = LocalModelOptions &
  Omit<Parameters<typeof streamText>[0], "model">;

export function streamLocalText(options: StreamLocalTextOptions) {
  const { baseURL, modelId, apiKey, name, ...rest } = options;
  const model = resolveLocalModel({ baseURL, modelId, apiKey, name });
  return streamText({ model, ...rest } as Parameters<typeof streamText>[0]);
}

export type GenerateLocalObjectOptions<T> = LocalModelOptions & {
  schema: z.ZodType<T>;
} & Omit<Parameters<typeof generateObject>[0], "model" | "schema">;

export async function generateLocalObject<T>(options: GenerateLocalObjectOptions<T>) {
  const { baseURL, modelId, apiKey, name, schema, ...rest } = options;
  const model = resolveLocalModel({ baseURL, modelId, apiKey, name });
  return generateObject({
    model,
    schema,
    ...rest,
  } as Parameters<typeof generateObject>[0]);
}
