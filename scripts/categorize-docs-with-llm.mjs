#!/usr/bin/env node
/**
 * Categorize TypeScript docs candidates with DeepSeek v4 flash (AI SDK).
 *
 * Default model: deepseek/deepseek-v4-flash
 * Key: DEEPSEEK_API_KEY from monorepo-root or ledgeindex .env
 *
 * Usage (from ledgeindex/):
 *   node scripts/categorize-docs-with-llm.mjs
 *   node scripts/categorize-docs-with-llm.mjs --input ./top-typescript-docs.json
 *   node scripts/categorize-docs-with-llm.mjs --limit 20
 *   node scripts/categorize-docs-with-llm.mjs --concurrency 10
 *   node scripts/categorize-docs-with-llm.mjs --resume
 *   node scripts/categorize-docs-with-llm.mjs --model deepseek-v4-flash
 *
 * DeepSeek note: uses json_object mode (not json_schema). Output is still
 * validated against the Zod enum schema locally.
 *
 * Optional LM Studio fallback:
 *   node scripts/categorize-docs-with-llm.mjs --provider lmstudio --model "qwen/qwen3.5-9b"
 *
 * Categories (LedgeIndex shelves):
 *   frameworks | libraries | apis-services | tooling | uncategorized
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ledgeRoot = resolve(__dirname, "..");
const monoRoot = resolve(ledgeRoot, "..");
const require = createRequire(import.meta.url);

const DEEPSEEK_BASE_URL = "https://api.deepseek.com/v1";
const DEFAULT_DEEPSEEK_MODEL = "deepseek-v4-flash";
const TOKEN_KEYS = ["DEEPSEEK_API_KEY"];

function loadWorkspaceModule(candidates) {
  for (const id of candidates) {
    try {
      return require(id);
    } catch {
      // try next
    }
  }
  throw new Error(
    `Could not resolve ${candidates[0]}. Run npm install in ledgeindex/.`,
  );
}

const { createOpenAI } = loadWorkspaceModule(["@ai-sdk/openai"]);
const { generateText } = loadWorkspaceModule(["ai"]);
const { z } = loadWorkspaceModule(["zod"]);

const SHELF_CATEGORIES = [
  "frameworks",
  "libraries",
  "apis-services",
  "tooling",
  "uncategorized",
];

const categorySchema = z.object({
  category: z
    .enum(SHELF_CATEGORIES)
    .describe("Primary LedgeIndex bookshelf shelf for this package"),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe("0–1 confidence in the category choice"),
  reason: z
    .string()
    .max(280)
    .describe("One short sentence why this shelf fits"),
});

const args = process.argv.slice(2);
function argValue(flag, fallback = null) {
  const i = args.findIndex((a) => a === flag);
  if (i === -1) return fallback;
  const next = args[i + 1];
  if (!next || next.startsWith("-")) return true;
  return next;
}

const inputPath = resolve(
  process.cwd(),
  String(argValue("--input", resolve(ledgeRoot, "top-typescript-docs.json"))),
);
const outPath = resolve(
  process.cwd(),
  String(
    argValue(
      "--out",
      // Single source of truth — write back to the same list by default.
      inputPath,
    ),
  ),
);
const checkpointPath = resolve(
  process.cwd(),
  String(
    argValue(
      "--checkpoint",
      resolve(ledgeRoot, ".cache/docs-category-checkpoint.json"),
    ),
  ),
);
const provider = String(argValue("--provider", "deepseek")).toLowerCase();
const resume = args.includes("--resume");
const limitRaw = argValue("--limit", null);
const limit = limitRaw == null ? null : Math.max(1, Number(limitRaw) || 1);
const modelFlag = argValue("--model", null);
const concurrency = Math.min(
  20,
  Math.max(1, Number(argValue("--concurrency", 10)) || 10),
);

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return {};
  const out = {};
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    out[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

function resolveDeepseekKey() {
  for (const key of TOKEN_KEYS) {
    const fromEnv = process.env[key]?.trim();
    if (fromEnv) return { key: fromEnv, source: `env:${key}` };
  }
  for (const root of [monoRoot, ledgeRoot]) {
    const parsed = loadEnvFile(resolve(root, ".env"));
    for (const key of TOKEN_KEYS) {
      const value = parsed[key]?.trim();
      if (value) return { key: value, source: `${root}/.env (${key})` };
    }
  }
  return { key: "", source: null };
}

function mapHeuristicCategory(raw) {
  if (!raw) return null;
  const map = {
    framework: "frameworks",
    frameworks: "frameworks",
    library: "libraries",
    libraries: "libraries",
    "api-service": "apis-services",
    "apis-services": "apis-services",
    tooling: "tooling",
    tool: "tooling",
    uncategorized: "uncategorized",
  };
  return map[String(raw)] ?? null;
}

function progressLine(done, total, pkg, category, confidence) {
  const width = 24;
  const filled = Math.round((done / Math.max(total, 1)) * width);
  const bar = `${"█".repeat(filled)}${"░".repeat(Math.max(0, width - filled))}`;
  const pct = String(Math.round((done / Math.max(total, 1)) * 100)).padStart(3);
  const conf =
    typeof confidence === "number" ? ` ${(confidence * 100).toFixed(0)}%` : "";
  return `[${bar}] ${pct}%  ${String(done).padStart(4)}/${total}  ${pkg} → ${category}${conf}`;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function loadCheckpoint() {
  if (!resume || !existsSync(checkpointPath)) {
    return { results: {}, updatedAt: null };
  }
  try {
    return JSON.parse(readFileSync(checkpointPath, "utf8"));
  } catch {
    return { results: {}, updatedAt: null };
  }
}

function saveCheckpoint(state) {
  mkdirSync(dirname(checkpointPath), { recursive: true });
  writeFileSync(
    checkpointPath,
    `${JSON.stringify({ ...state, updatedAt: new Date().toISOString() }, null, 2)}\n`,
  );
}

function createModel() {
  if (provider === "lmstudio") {
    const baseURL = String(
      argValue(
        "--base-url",
        process.env.LM_STUDIO_BASE_URL || "http://127.0.0.1:1234/v1",
      ),
    ).replace(/\/$/, "");
    const modelId = modelFlag ? String(modelFlag) : "local-model";
    const openai = createOpenAI({
      baseURL,
      apiKey: "lm-studio",
      name: "lm-studio",
    });
    return {
      model: openai.chat(modelId),
      modelId,
      label: `LM Studio ${baseURL}`,
    };
  }

  // default: deepseek v4 flash (same as ledgeindex core/docs strategies)
  const { key, source } = resolveDeepseekKey();
  if (!key) {
    console.error(`No DEEPSEEK_API_KEY found.

Add it to the monorepo-root .env:
  DEEPSEEK_API_KEY=...
`);
    process.exit(1);
  }

  let modelId = modelFlag ? String(modelFlag) : DEFAULT_DEEPSEEK_MODEL;
  // Allow deepseek/deepseek-v4-flash style ids from ledgeindex strategies.
  if (modelId.startsWith("deepseek/")) {
    modelId = modelId.slice("deepseek/".length);
  }

  const openai = createOpenAI({
    apiKey: key,
    baseURL: DEEPSEEK_BASE_URL,
    name: "deepseek",
  });
  return {
    model: openai.chat(modelId),
    modelId,
    label: `DeepSeek ${DEEPSEEK_BASE_URL} (key: ${source})`,
  };
}

if (!existsSync(inputPath)) {
  console.error(`Input not found: ${inputPath}`);
  console.error("Run: node scripts/build-typescript-docs-list.mjs --limit 250");
  process.exit(1);
}

const input = JSON.parse(readFileSync(inputPath, "utf8"));
if (!Array.isArray(input) || input.length === 0) {
  console.error("Input JSON must be a non-empty array of package entries.");
  process.exit(1);
}

let entries = input;
if (limit != null) entries = entries.slice(0, limit);

const { model, modelId, label } = createModel();
console.log(`Provider: ${provider}`);
console.log(`Model:    ${modelId}`);
console.log(`Client:   ${label}`);
console.log(`Entries:  ${entries.length}`);
console.log(`Output:   ${outPath}`);
console.log(`Resume:   ${resume ? "yes" : "no"}`);
function extractJsonObject(text) {
  if (!text) return null;
  const trimmed = String(text).trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start === -1 || end <= start) return null;
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

async function categorizeOne(entry, model, modelId) {
  const pkg = entry.package || entry.pkg;
  const heuristic = mapHeuristicCategory(entry.category);
  // DeepSeek supports json_object, NOT json_schema. Ask for JSON in the prompt
  // and parse + validate with Zod ourselves.
  const prompt = `Classify this npm/documentation package into exactly one LedgeIndex bookshelf category.

Return ONLY a json object with this exact shape:
{"category":"libraries","confidence":0.9,"reason":"short reason"}

category must be one of:
- "frameworks": app/runtime skeletons (Next.js, NestJS, Express, Angular, Electron, Nuxt, Astro…)
- "libraries": reusable imports (React, Zod, TanStack Query, Tailwind, UI kits, ORMs…)
- "apis-services": hosted API/SaaS SDKs (Stripe, Firebase, OpenAI, AWS SDK, Clerk, Sentry…)
- "tooling": compilers/bundlers/linters/tests/CLIs (TypeScript, Vite, ESLint, Playwright, pnpm…)
- "uncategorized": only if truly unclear

Package: ${pkg}
Description: ${entry.description || "(none)"}
Homepage/docs: ${entry.docs || entry.homepage || "(none)"}
Heuristic guess (may be wrong): ${heuristic || "(none)"}`;

  let object = null;
  let lastError = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const result = await generateText({
        model,
        prompt,
        temperature: 0,
        maxOutputTokens: 300,
        providerOptions: {
          openai: {
            // Force OpenAI-compatible json_object (DeepSeek rejects json_schema).
            structuredOutputs: false,
            responseFormat: { type: "json_object" },
          },
        },
      });
      const raw = extractJsonObject(result.text);
      const parsed = categorySchema.safeParse(raw);
      if (!parsed.success) {
        throw new Error(
          `Invalid json category payload: ${parsed.error.message}`,
        );
      }
      object = parsed.data;
      lastError = null;
      break;
    } catch (error) {
      lastError = error;
      if (attempt < 2) await sleep(750);
    }
  }

  if (object) {
    return {
      package: pkg,
      category: object.category,
      confidence: object.confidence,
      reason: object.reason,
      docs: entry.docs || entry.homepage || null,
      description: entry.description || null,
      downloadsLastMonth: entry.downloadsLastMonth ?? null,
      heuristicCategory: heuristic,
      modelId,
    };
  }

  const message =
    lastError instanceof Error ? lastError.message : String(lastError);
  return {
    package: pkg,
    category: heuristic || "uncategorized",
    confidence: 0,
    reason: `Model failed after retry; fell back. ${message.slice(0, 160)}`,
    docs: entry.docs || entry.homepage || null,
    description: entry.description || null,
    downloadsLastMonth: entry.downloadsLastMonth ?? null,
    heuristicCategory: heuristic,
    modelId,
    error: message,
  };
}

function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

console.log(`Concurrency: ${concurrency}`);
console.log("");

const checkpoint = loadCheckpoint();
const results = { ...(checkpoint.results || {}) };

const total = entries.length;
const started = Date.now();
let done = 0;

// Skip already-good checkpoint rows.
const pending = entries.filter((entry) => {
  const pkg = entry.package || entry.pkg;
  return pkg && !(results[pkg]?.category && !results[pkg]?.error);
});

for (const group of chunk(pending, concurrency)) {
  const settled = await Promise.all(
    group.map(async (entry) => {
      const row = await categorizeOne(entry, model, modelId);
      return row;
    }),
  );
  for (const row of settled) {
    results[row.package] = row;
    done += 1;
    process.stdout.write(
      `\r${progressLine(done, pending.length || total, row.package, row.category, row.confidence)}   `,
    );
  }
  saveCheckpoint({ results });
}

process.stdout.write("\n\n");

const categorized = entries.map((entry, idx) => {
  const pkg = entry.package || entry.pkg;
  const llm = results[pkg] || {};
  return {
    ...entry,
    rank: idx + 1,
    package: pkg,
    category:
      llm.category ||
      mapHeuristicCategory(entry.category) ||
      entry.category ||
      "uncategorized",
    categoryConfidence: llm.confidence ?? entry.categoryConfidence ?? null,
    categoryReason: llm.reason ?? entry.categoryReason ?? null,
    modelId: llm.modelId || entry.modelId || modelId,
  };
});

const byCategory = {
  frameworks: [],
  libraries: [],
  "apis-services": [],
  tooling: [],
  uncategorized: [],
};
for (const row of categorized) {
  const key = byCategory[row.category] ? row.category : "uncategorized";
  byCategory[key].push(row.package);
}

writeFileSync(outPath, `${JSON.stringify(categorized, null, 2)}\n`);

const elapsedSec = ((Date.now() - started) / 1000).toFixed(1);
console.log("Category counts:");
for (const [cat, rows] of Object.entries(byCategory)) {
  console.log(`  ${cat.padEnd(14)} ${rows.length}`);
}
console.log("");
console.log(`Done in ${elapsedSec}s`);
console.log(`Wrote ${categorized.length} → ${outPath}`);
