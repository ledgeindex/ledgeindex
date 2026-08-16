import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { flagBool, flagString, type ParsedArgs } from "./parse-args.js";

export type ChatProvider = "google" | "openai" | "deepseek";

export type LedgeIndexCliConfig = {
  dataDir?: string;
  /** Preferred chat/crawl LLM provider. Omit for automatic priority. */
  provider?: ChatProvider;
  keys?: {
    openai?: string;
    google?: string;
    deepseek?: string;
    cohere?: string;
  };
};

const CONFIG_DIR =
  process.platform === "win32"
    ? path.join(process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"), "ledgeindex")
    : path.join(os.homedir(), ".config", "ledgeindex");

const CONFIG_PATH = path.join(CONFIG_DIR, "config.json");

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
  const normalized = raw.trim().toLowerCase();
  return PROVIDER_ALIASES[normalized];
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

export function hasKeyForProvider(
  keys: NonNullable<LedgeIndexCliConfig["keys"]>,
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

export function providerLabel(provider: ChatProvider): string {
  switch (provider) {
    case "google":
      return "Google Gemini";
    case "openai":
      return "OpenAI";
    case "deepseek":
      return "DeepSeek";
  }
}

export async function loadConfig(): Promise<LedgeIndexCliConfig> {
  try {
    const raw = await readFile(CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw) as LedgeIndexCliConfig;
    return parsed ?? {};
  } catch {
    return {};
  }
}

export async function saveConfig(config: LedgeIndexCliConfig): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true });
  await writeFile(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

export function configPath(): string {
  return CONFIG_PATH;
}

export function resolveConfig(config: LedgeIndexCliConfig): {
  dataDir: string;
  provider?: ChatProvider;
  keys: NonNullable<LedgeIndexCliConfig["keys"]>;
} {
  const dataDir =
    process.env.LEDGEINDEX_DATA_DIR?.trim() ||
    config.dataDir?.trim() ||
    getDefaultDataDir();

  const provider =
    parseChatProvider(process.env.LEDGEINDEX_PROVIDER) ??
    parseChatProvider(config.provider);

  const keys = {
    openai:
      process.env.OPENAI_API_KEY?.trim() || config.keys?.openai?.trim() || undefined,
    google:
      process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim() ||
      config.keys?.google?.trim() ||
      undefined,
    deepseek:
      process.env.DEEPSEEK_API_KEY?.trim() ||
      config.keys?.deepseek?.trim() ||
      undefined,
    cohere:
      process.env.COHERE_API_KEY?.trim() || config.keys?.cohere?.trim() || undefined,
  };

  return { dataDir, provider, keys };
}

export function applyKeysToProcessEnv(keys: ReturnType<typeof resolveConfig>["keys"]) {
  if (keys.openai) process.env.OPENAI_API_KEY = keys.openai;
  if (keys.google) process.env.GOOGLE_GENERATIVE_AI_API_KEY = keys.google;
  if (keys.deepseek) process.env.DEEPSEEK_API_KEY = keys.deepseek;
  if (keys.cohere) process.env.COHERE_API_KEY = keys.cohere;
}

export function applyProviderToProcessEnv(provider: ChatProvider | undefined) {
  if (!provider) {
    delete process.env.LEDGEINDEX_PRUNER_BACKEND;
    return;
  }
  process.env.LEDGEINDEX_PRUNER_BACKEND = providerPrunerBackend(provider);
}

export function hasChatModelKey(keys: ReturnType<typeof resolveConfig>["keys"]): boolean {
  return Boolean(keys.openai || keys.google || keys.deepseek);
}

export function validateChatProvider(
  resolved: ReturnType<typeof resolveConfig>,
): string | null {
  if (resolved.provider) {
    if (!hasKeyForProvider(resolved.keys, resolved.provider)) {
      return `No API key for provider "${resolved.provider}". Run: ledgeindex config set ${resolved.provider} <key>`;
    }
    return null;
  }

  if (!hasChatModelKey(resolved.keys)) {
    return [
      "No chat model key found. Set one with:",
      "  ledgeindex config set openai <key>",
      "  ledgeindex config set google <key>",
      "  ledgeindex config set deepseek <key>",
      "Or export OPENAI_API_KEY / GOOGLE_GENERATIVE_AI_API_KEY / DEEPSEEK_API_KEY",
    ].join("\n");
  }

  return null;
}

export function validateCrawlAiFeatures(
  resolved: ReturnType<typeof resolveConfig>,
  flags: ParsedArgs["flags"],
): string | null {
  const wantsFilter = flagBool(flags, "filter");
  const wantsEnrich = flagBool(flags, "enrich");
  if (!wantsFilter && !wantsEnrich) {
    return null;
  }

  const features = [
    wantsFilter ? "AI URL filter (--filter)" : null,
    wantsEnrich ? "example enrichment (--enrich)" : null,
  ]
    .filter(Boolean)
    .join(" and ");

  const keyError = validateChatProvider(resolved);
  if (keyError) {
    return `${features} requires a chat model key.\n${keyError}`;
  }
  return null;
}

export function applyRuntimeFlagOverrides(
  config: LedgeIndexCliConfig,
  flags: ParsedArgs["flags"],
): LedgeIndexCliConfig {
  const provider = flagString(flags, "provider");
  if (!provider) return config;

  const parsed = parseChatProvider(provider);
  if (!parsed) {
    throw new Error(
      `Unknown provider "${provider}". Use google, openai, or deepseek.`,
    );
  }

  return { ...config, provider: parsed };
}

export async function setConfigValue(
  key: string,
  value: string,
): Promise<LedgeIndexCliConfig> {
  const config = await loadConfig();

  switch (key) {
    case "dataDir":
    case "data-dir":
      config.dataDir = value;
      break;
    case "provider":
    case "default-provider": {
      if (value.trim().toLowerCase() === "auto") {
        delete config.provider;
      } else {
        const parsed = parseChatProvider(value);
        if (!parsed) {
          throw new Error(
            `Unknown provider "${value}". Use google, openai, deepseek, or "auto" to clear.`,
          );
        }
        config.provider = parsed;
      }
      break;
    }
    case "openai":
    case "openai-key":
      config.keys = { ...config.keys, openai: value };
      break;
    case "google":
    case "google-key":
      config.keys = { ...config.keys, google: value };
      break;
    case "deepseek":
    case "deepseek-key":
      config.keys = { ...config.keys, deepseek: value };
      break;
    case "cohere":
    case "cohere-key":
      config.keys = { ...config.keys, cohere: value };
      break;
    default:
      throw new Error(`Unknown config key: ${key}`);
  }

  await saveConfig(config);
  return config;
}
