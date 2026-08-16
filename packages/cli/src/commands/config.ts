import type { ParsedArgs } from "../parse-args.js";

export async function runConfigCommand(args: ParsedArgs): Promise<number> {
  const {
    loadConfig,
    resolveConfig,
    setConfigValue,
    configPath,
    hasChatModelKey,
    providerLabel,
  } = await import("../config.js");

  const action = args.subcommand;
  if (!action || action === "help") {
    console.log(`Usage:
  ledgeindex config show
  ledgeindex config set <key> <value>

Keys:
  dataDir      Local index data (~/.ledgeindex/data)
  provider     Default LLM provider: google | openai | deepseek | auto
  openai       OpenAI API key (chat + crawl filter)
  google       Google Gemini API key (chat + crawl filter)
  deepseek     DeepSeek API key (chat + crawl filter)
  cohere       Cohere API key (optional rerank)

Per-command override: --provider google|openai|deepseek

Config file: ${configPath()}`);
    return 0;
  }

  if (action === "show") {
    const config = await loadConfig();
    const resolved = resolveConfig(config);
    const mask = (value: string) =>
      value.length <= 8 ? "********" : `${value.slice(0, 4)}…${value.slice(-4)}`;

    console.log(
      JSON.stringify(
        {
          dataDir: resolved.dataDir,
          provider: resolved.provider ?? "auto",
          keys: {
            openai: resolved.keys.openai ? mask(resolved.keys.openai) : null,
            google: resolved.keys.google ? mask(resolved.keys.google) : null,
            deepseek: resolved.keys.deepseek ? mask(resolved.keys.deepseek) : null,
            cohere: resolved.keys.cohere ? mask(resolved.keys.cohere) : null,
          },
          hasChatModelKey: hasChatModelKey(resolved.keys),
          activeProvider: resolved.provider
            ? providerLabel(resolved.provider)
            : "auto (google → deepseek → openai)",
        },
        null,
        2,
      ),
    );
    return 0;
  }

  if (action === "set") {
    const key = args.positional[0];
    const value = args.positional[1];
    if (!key || !value) {
      console.error("Usage: ledgeindex config set <key> <value>");
      return 2;
    }
    await setConfigValue(key, value);
    console.log(`Saved ${key} to ${configPath()}`);
    return 0;
  }

  console.error(`Unknown config command: ${action}`);
  return 2;
}
