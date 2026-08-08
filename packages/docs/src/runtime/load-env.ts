import { config } from "dotenv";
import { resolve } from "node:path";

// Monorepo root .env first, then ledgeindex-api/.env overrides.
config({ path: resolve(process.cwd(), "../.env") });
config({ path: resolve(process.cwd(), ".env"), override: true });

// Mastra Google provider reads GOOGLE_GENERATIVE_AI_API_KEY; accept GOOGLE_API_KEY alias.
if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY && process.env.GOOGLE_API_KEY) {
  process.env.GOOGLE_GENERATIVE_AI_API_KEY = process.env.GOOGLE_API_KEY;
}

// LM Studio OpenAI-compatible router (AutomationGhost pattern).
if (!process.env.LMSTUDIO_API_KEY?.trim()) {
  process.env.LMSTUDIO_API_KEY = "local";
}
