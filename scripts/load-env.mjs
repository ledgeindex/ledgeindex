import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const ledgeRoot = resolve(scriptsDir, "..");
const monoRoot = resolve(ledgeRoot, "..");

/** Same default as @ledgeindex/sdk — scripts must not fall back to ledgeindex/.data. */
const DEFAULT_DATA_DIR = join(homedir(), ".ledgeindex", "data");

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) return;
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const m = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    if (process.env[key]?.trim()) continue;
    const value = m[2].trim().replace(/^["']|["']$/g, "");
    if (value) process.env[key] = value;
  }
}

/**
 * Load env files, then default LEDGEINDEX_DATA_DIR.
 *
 * Call this before dynamically importing @ledgeindex/sdk — the metadata store
 * resolves its path at first import, so cwd must not matter.
 */
export function loadScriptEnv() {
  parseEnvFile(resolve(monoRoot, ".env"));
  parseEnvFile(resolve(ledgeRoot, ".env"));

  if (!process.env.LEDGEINDEX_DATA_DIR?.trim()) {
    process.env.LEDGEINDEX_DATA_DIR = DEFAULT_DATA_DIR;
  }

  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim() && process.env.GOOGLE_API_KEY?.trim()) {
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = process.env.GOOGLE_API_KEY.trim();
  }
}

export function hasChatKey() {
  return Boolean(
    process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim() ||
      process.env.OPENAI_API_KEY?.trim() ||
      process.env.DEEPSEEK_API_KEY?.trim() ||
      process.env.LM_STUDIO_BASE_URL?.trim(),
  );
}
