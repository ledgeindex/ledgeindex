import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const hostRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const monorepoRoot = resolve(hostRoot, "../..");

config({ path: resolve(monorepoRoot, ".env") });
config({ path: resolve(hostRoot, ".env"), override: true });

if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY && process.env.GOOGLE_API_KEY) {
  process.env.GOOGLE_GENERATIVE_AI_API_KEY = process.env.GOOGLE_API_KEY;
}

if (!process.env.LMSTUDIO_API_KEY?.trim()) {
  process.env.LMSTUDIO_API_KEY = "local";
}
