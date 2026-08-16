import os from "node:os";
import path from "node:path";
import type {
  ChatProvider,
  LedgeIndexKeys,
  LedgeIndexOptions,
  ResolvedLedgeIndexOptions,
} from "./types.js";

export const DEFAULT_SDK_USER_ID = "ledgeindex-sdk-local";

const PROVIDER_ALIASES: Record<string, ChatProvider> = {
  google: "google",
  gemini: "google",
  openai: "openai",
  deepseek: "deepseek",
};

export function getDefaultDataDir(): string {
  return path.join(os.homedir(), ".ledgeindex", "data");
}

export function parseChatProvider(
  raw: string | undefined,
): ChatProvider | undefined {
  if (!raw?.trim()) return undefined;
  return PROVIDER_ALIASES[raw.trim().toLowerCase()];
}

export function providerPrunerBackend(provider: ChatProvider): string {
  switch (provider) {
    case "google":
      return "api";
    case "openai":
      return "openai";
    case "deepseek":
      return "deepseek";
  }
}

export function resolveKeys(keys: LedgeIndexKeys = {}): LedgeIndexKeys {
  return {
    openai:
      process.env.OPENAI_API_KEY?.trim() || keys.openai?.trim() || undefined,
    google:
      process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim() ||
      keys.google?.trim() ||
      undefined,
    deepseek:
      process.env.DEEPSEEK_API_KEY?.trim() ||
      keys.deepseek?.trim() ||
      undefined,
    cohere:
      process.env.COHERE_API_KEY?.trim() || keys.cohere?.trim() || undefined,
  };
}

export function resolveOptions(
  options: LedgeIndexOptions = {},
): ResolvedLedgeIndexOptions {
  const dataDir =
    process.env.LEDGEINDEX_DATA_DIR?.trim() ||
    options.dataDir?.trim() ||
    getDefaultDataDir();

  const provider =
    parseChatProvider(process.env.LEDGEINDEX_PROVIDER) ??
    options.provider;

  const keys = resolveKeys(options.keys);

  const postgresUrl =
    options.postgresUrl?.trim() ||
    process.env.POSTGRES_CONNECTION_STRING?.trim() ||
    undefined;

  const vectorBackend =
    options.vectorBackend ??
    (process.env.LEDGEINDEX_VECTOR_BACKEND?.toLowerCase() === "pgvector" ||
    process.env.LEDGEINDEX_VECTOR_BACKEND?.toLowerCase() === "postgres" ||
    process.env.LEDGEINDEX_VECTOR_BACKEND?.toLowerCase() === "pg" ||
    postgresUrl
      ? "pgvector"
      : "libsql");

  const rerankBackend =
    options.rerankBackend ??
    (process.env.LEDGEINDEX_RERANK_BACKEND as ResolvedLedgeIndexOptions["rerankBackend"]) ??
    undefined;

  return {
    dataDir,
    localUserId: options.localUserId?.trim() || DEFAULT_SDK_USER_ID,
    provider,
    keys,
    vectorBackend,
    postgresUrl,
    rerankBackend,
  };
}

export function applyOptionsToProcessEnv(resolved: ResolvedLedgeIndexOptions) {
  if (resolved.keys.openai) process.env.OPENAI_API_KEY = resolved.keys.openai;
  if (resolved.keys.google) {
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = resolved.keys.google;
  }
  if (resolved.keys.deepseek) {
    process.env.DEEPSEEK_API_KEY = resolved.keys.deepseek;
  }
  if (resolved.keys.cohere) process.env.COHERE_API_KEY = resolved.keys.cohere;

  if (resolved.provider) {
    process.env.LEDGEINDEX_PRUNER_BACKEND = providerPrunerBackend(
      resolved.provider,
    );
  }

  process.env.LEDGEINDEX_DATA_DIR = resolved.dataDir;
  process.env.LEDGEINDEX_AUTH_REQUIRED = "0";
  process.env.LEDGEINDEX_LOCAL_USER_ID = resolved.localUserId;

  if (resolved.vectorBackend === "pgvector") {
    process.env.LEDGEINDEX_VECTOR_BACKEND = "pgvector";
    if (resolved.postgresUrl) {
      process.env.POSTGRES_CONNECTION_STRING = resolved.postgresUrl;
    }
  } else {
    delete process.env.LEDGEINDEX_VECTOR_BACKEND;
  }

  if (resolved.rerankBackend) {
    process.env.LEDGEINDEX_RERANK_BACKEND = resolved.rerankBackend;
  }
}

export function hasChatModelKey(keys: LedgeIndexKeys): boolean {
  return Boolean(keys.openai || keys.google || keys.deepseek);
}

export function hasKeyForProvider(
  keys: LedgeIndexKeys,
  provider: ChatProvider,
): boolean {
  switch (provider) {
    case "google":
      return Boolean(keys.google);
    case "openai":
      return Boolean(keys.openai);
    case "deepseek":
      return Boolean(keys.deepseek);
  }
}

export function validateOptions(resolved: ResolvedLedgeIndexOptions): void {
  if (resolved.vectorBackend === "pgvector") {
    if (!resolved.postgresUrl && !process.env.POSTGRES_CONNECTION_STRING?.trim()) {
      throw new Error(
        "pgvector requires postgresUrl or POSTGRES_CONNECTION_STRING",
      );
    }
    if (!resolved.keys.google) {
      throw new Error(
        "pgvector requires keys.google (GOOGLE_GENERATIVE_AI_API_KEY) for Gemini embeddings",
      );
    }
  }

  if (resolved.provider) {
    if (!hasKeyForProvider(resolved.keys, resolved.provider)) {
      throw new Error(`No API key for provider "${resolved.provider}"`);
    }
  }
}

/** Requires a chat model key — for ask, AI URL filter, or example enrichment. */
export function assertChatModelAvailable(
  resolved: ResolvedLedgeIndexOptions,
  feature: string,
): void {
  if (resolved.provider) {
    if (!hasKeyForProvider(resolved.keys, resolved.provider)) {
      throw new Error(
        `No API key for provider "${resolved.provider}" (${feature})`,
      );
    }
    return;
  }

  if (!hasChatModelKey(resolved.keys)) {
    throw new Error(
      `${feature} requires a chat model key (google, openai, or deepseek)`,
    );
  }
}
