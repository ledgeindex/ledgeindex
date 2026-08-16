/**
 * Query an indexed repo source.
 *
 *   node ledgeindex/scripts/query-repo.mjs stagehand "what are the primitives"
 *
 * Loads ledgeindex/.env automatically. Uses agent mode when a chat key is present.
 * Force retrieve-only: LEDGEINDEX_ASK_MODE=retrieve-only
 */
import { hasChatKey, loadScriptEnv } from "./load-env.mjs";

loadScriptEnv();
const { createLedgeIndex } = await import("../packages/sdk/dist/index.js");

const slug = process.argv[2];
const question = process.argv.slice(3).join(" ").trim();

if (!slug || !question) {
  console.error("Usage: node scripts/query-repo.mjs <slug> <question>");
  process.exit(2);
}

const li = await createLedgeIndex({
  dataDir: process.env.LEDGEINDEX_DATA_DIR,
  keys: {
    google: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
    openai: process.env.OPENAI_API_KEY,
    deepseek: process.env.DEEPSEEK_API_KEY,
    cohere: process.env.COHERE_API_KEY,
  },
});

const askMode = process.env.LEDGEINDEX_ASK_MODE?.trim().toLowerCase();
const mode =
  askMode === "retrieve-only"
    ? "retrieve-only"
    : askMode === "agent"
      ? "agent"
      : hasChatKey()
        ? "agent"
        : "retrieve-only";

const { answer, citations, insufficient } = await li.ask(slug, question, {
  mode,
});

console.log(`data: ${li.dataDir}`);
console.log(`query: ${question}`);
console.log(`mode: ${mode} | insufficient: ${insufficient}\n`);

if (mode === "agent" && answer) {
  console.log(answer);
  if (citations.length > 0) {
    console.log(`\nCitations (${citations.length}):`);
  }
} else if (answer) {
  console.log(answer);
}

for (const cite of citations) {
  console.log(`${cite.score.toFixed(3)}  ${cite.name}`);
  console.log(`         ${cite.url}`);
}
