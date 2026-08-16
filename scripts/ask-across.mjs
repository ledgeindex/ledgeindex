/**
 * Ask across several sources with one synthesized answer.
 *
 * Picker mode (default) — LLM chooses which pinned sources to read:
 *   node ledgeindex/scripts/ask-across.mjs stagehand,stagehand-docs "how does act() work"
 *   node ledgeindex/scripts/ask-across.mjs --set stagehand-stack "how does act() work"
 *
 * All mode — always read every pinned source, no picker:
 *   node ledgeindex/scripts/ask-across.mjs --all stagehand,stagehand-docs "how does act() work"
 *   node ledgeindex/scripts/ask-across.mjs --all --set stagehand-stack "how does act() work"
 *
 * Loads ledgeindex/.env automatically. Requires a chat key.
 */
import { hasChatKey, loadScriptEnv } from "./load-env.mjs";

loadScriptEnv();
const { createLedgeIndex } = await import("../packages/sdk/dist/index.js");

function parseArgs(argv) {
  let usesSet = false;
  let sourceMode = "picker";
  const positional = [];

  for (const arg of argv) {
    if (arg === "--set") {
      usesSet = true;
      continue;
    }
    if (arg === "--all") {
      sourceMode = "all";
      continue;
    }
    if (arg === "--picker") {
      sourceMode = "picker";
      continue;
    }
    positional.push(arg);
  }

  const target = positional[0];
  const question = positional.slice(1).join(" ").trim();
  return { usesSet, sourceMode, target, question };
}

const { usesSet, sourceMode, target, question } = parseArgs(process.argv.slice(2));

if (!target || !question) {
  console.error(
    "Usage: node scripts/ask-across.mjs [--all|--picker] <slug,slug> <question>\n" +
      "       node scripts/ask-across.mjs [--all|--picker] --set <set-slug> <question>\n" +
      "\n" +
      "  --picker  LLM picks which sources to read (default)\n" +
      "  --all     always read every pinned source",
  );
  process.exit(2);
}

if (!hasChatKey()) {
  console.error(
    "A chat key is required. Set GOOGLE_GENERATIVE_AI_API_KEY in ledgeindex/.env.",
  );
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

const sources = usesSet
  ? { sourceSet: target, sourceMode }
  : {
      sources: target.split(",").map((slug) => slug.trim()).filter(Boolean),
      sourceMode,
    };

const { answer, citations, insufficient, pickedSources } = await li.askAcross(
  question,
  sources,
);

console.log(`data: ${li.dataDir}`);
console.log(`query: ${question}`);
console.log(`mode: ${sourceMode}`);
console.log(
  `read: ${pickedSources.map((s) => `${s.slug} (${s.kind})`).join(", ") || "none"} | insufficient: ${insufficient}\n`,
);
console.log(answer);

if (citations.length > 0) {
  console.log(`\nCitations (${citations.length}):`);
  for (const cite of citations) {
    console.log(`${cite.score.toFixed(3)}  ${cite.name}`);
    console.log(`         ${cite.url}`);
  }
}
