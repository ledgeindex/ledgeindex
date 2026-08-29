/**
 * Profile a documentation site and draft concise answer-agent instructions.
 *
 * Prerequisite:
 *   npm run build --workspace @ledgeindex/core --workspace @ledgeindex/profile
 *
 * Usage:
 *   node scripts/test-docs-system-prompt.mjs
 *   node scripts/test-docs-system-prompt.mjs https://mastra.ai/docs
 *   node scripts/test-docs-system-prompt.mjs https://mastra.ai/docs --model google/gemini-3.5-flash-lite
 */
import { loadScriptEnv } from "./load-env.mjs";

loadScriptEnv();

function parseArgs(argv) {
  let url = "https://mastra.ai/docs";
  let modelId;
  let maxPages = 250;

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--model" && argv[index + 1]) {
      modelId = argv[++index];
    } else if (arg === "--max-pages" && argv[index + 1]) {
      const parsed = Number(argv[++index]);
      if (Number.isFinite(parsed) && parsed > 0) maxPages = parsed;
    } else if (arg === "--help" || arg === "-h") {
      console.log(
        "Usage: node scripts/test-docs-system-prompt.mjs [url] [--model provider/model] [--max-pages number]",
      );
      process.exit(0);
    } else if (!arg.startsWith("--")) {
      url = arg;
    }
  }

  return { url, modelId, maxPages };
}

function docsLabel(url) {
  const hostname = new URL(url).hostname.replace(/^www\./i, "");
  const firstLabel = hostname.split(".")[0] || hostname;
  return firstLabel.charAt(0).toUpperCase() + firstLabel.slice(1);
}

function buildDocsSystemPrompt({ rootUrl, profile }) {
  const identity = profile.docs_identity;
  const topics = profile.docs_topics?.topics ?? [];
  if (!identity) {
    throw new Error("The docs_identity lens did not produce a profile");
  }

  const topicLines = topics.map(
    (topic) => `- ${topic.name}: ${topic.description}`,
  );
  const label = docsLabel(rootUrl);

  return [
    `You are a documentation assistant for ${label}.`,
    "",
    "Documentation scope:",
    identity.overallSummary.trim(),
    "",
    "Main topics covered:",
    ...(topicLines.length > 0
      ? topicLines
      : ["- No main topics were confidently identified."]),
    "",
    "Answer questions only from retrieved documentation context. Explain how the relevant concepts fit within this documentation scope, and cite the exact source URLs supplied with the retrieved context. If the documentation does not support a claim, say so.",
  ].join("\n");
}

const options = parseArgs(process.argv);
const { profileSite } = await import("../packages/profile/dist/index.js");

console.error(`Profiling ${options.url}`);
const result = await profileSite(
  options.url,
  ["docs_identity", "docs_topics"],
  {
    modelId: options.modelId,
    maxPages: options.maxPages,
    onProgress(progress) {
      const lens = progress.lens ? ` · ${progress.lens}` : "";
      console.error(`${progress.phase}${lens}`);
    },
  },
);

const systemPrompt = buildDocsSystemPrompt({
  rootUrl: result.rootUrl,
  profile: result.profile,
});

console.log("\n=== GENERATED SYSTEM PROMPT ===\n");
console.log(systemPrompt);
console.log("\n=== STRUCTURED PROFILE ===\n");
console.log(
  JSON.stringify(
    {
      rootUrl: result.rootUrl,
      modelId: result.modelId,
      crawledPages: result.crawl.urlCount,
      docsIdentity: result.profile.docs_identity,
      docsTopics: result.profile.docs_topics?.topics ?? [],
    },
    null,
    2,
  ),
);
