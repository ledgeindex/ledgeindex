/**
 * Crawl + index a docs site into ~/.ledgeindex/data (or LEDGEINDEX_DATA_DIR).
 *
 *   node ledgeindex/scripts/index-docs.mjs https://mastra.ai/docs mastra-docs
 *   node ledgeindex/scripts/index-docs.mjs https://mastra.ai/docs --max-pages 50
 *
 * Loads ledgeindex/.env automatically. No chat key required unless you pass
 * --filter (LLM URL cleanup) or --enrich (example enrichment).
 */
import { hasChatKey, loadScriptEnv } from "./load-env.mjs";

loadScriptEnv();
const { createLedgeIndex } = await import("../packages/sdk/dist/index.js");

function parseArgs(argv) {
  let url;
  let name;
  let maxPages;
  let autoFilter = false;
  let enrichExamples = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--max-pages") {
      maxPages = Number(argv[++i]);
      continue;
    }
    if (arg === "--filter") {
      autoFilter = true;
      continue;
    }
    if (arg === "--enrich") {
      enrichExamples = true;
      continue;
    }
    if (!url) url = arg;
    else if (!name) name = arg;
  }

  return { url, name, maxPages, autoFilter, enrichExamples };
}

const { url, name, maxPages, autoFilter, enrichExamples } = parseArgs(
  process.argv.slice(2),
);

if (!url) {
  console.error(
    "Usage: node scripts/index-docs.mjs <docs-url> [name] [--max-pages N] [--filter] [--enrich]",
  );
  process.exit(2);
}

if (autoFilter && !hasChatKey()) {
  console.error("--filter needs a chat key (GOOGLE_GENERATIVE_AI_API_KEY, etc.)");
  process.exit(2);
}

if (enrichExamples && !hasChatKey()) {
  console.error("--enrich needs a chat key (GOOGLE_GENERATIVE_AI_API_KEY, etc.)");
  process.exit(2);
}

let lastIndexLine = "";

function logProgress(update) {
  switch (update.phase) {
    case "preflight":
      console.log(`[preflight] ${update.detail}`);
      break;
    case "crawl": {
      const p = update.crawlProgress;
      if (p?.phase === "validating") {
        const pct = p.validationTotal
          ? Math.round(((p.validatedCount ?? 0) / p.validationTotal) * 100)
          : 0;
        process.stdout.write(
          `\r[crawl] validating ${p.validatedCount ?? 0}/${p.validationTotal ?? 0} (${pct}%)   `,
        );
        if ((p.validatedCount ?? 0) >= (p.validationTotal ?? 0) && p.validationTotal) {
          console.log();
        }
      } else if (p) {
        process.stdout.write(
          `\r[crawl] discovered ${p.pagesDiscovered}/${p.maxPages} pages   `,
        );
      } else {
        console.log(`[crawl] ${update.detail}`);
      }
      break;
    }
    case "filter":
      console.log(`\n[filter] ${update.detail}`);
      break;
    case "index": {
      const live = update.pipeline?.liveProgress;
      const subphase = update.pipeline?.livePhase;
      if (live && live.total > 0) {
        const pct = Math.round((live.current / live.total) * 100);
        const line = `[index] ${subphase ?? "index"} ${live.current}/${live.total} (${pct}%)`;
        if (line !== lastIndexLine) {
          process.stdout.write(`\r${line}   `);
          lastIndexLine = line;
        }
      } else if (!lastIndexLine) {
        console.log(`[index] ${update.detail}`);
      }
      break;
    }
    case "done":
      if (lastIndexLine) {
        process.stdout.write("\n");
        lastIndexLine = "";
      }
      console.log(`[done] ${update.detail}`);
      break;
    case "error":
      console.error(`[error] ${update.detail}`);
      break;
  }
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

const resolvedMaxPages =
  maxPages ??
  (process.env.LEDGEINDEX_CRAWL_MAX_PAGES
    ? Number(process.env.LEDGEINDEX_CRAWL_MAX_PAGES)
    : undefined);

const started = Date.now();
const result = await li.crawl({
  url,
  ...(name ? { name } : {}),
  ...(resolvedMaxPages ? { maxPages: resolvedMaxPages } : {}),
  autoFilter,
  enrichExamples,
  onProgress: logProgress,
});

const { slug } = await li.resolveSource(result.sourceId);

console.log(`\ndata: ${li.dataDir}`);
console.log(`source: ${slug} (${result.sourceId})`);
console.log(`url: ${result.url}`);
console.log(
  `${result.pageCount} pages · ${result.chunkCount} chunks · ${Math.round((Date.now() - started) / 1000)}s`,
);
console.log(`\nAsk docs only:`);
console.log(`  node scripts/query-repo.mjs ${slug} "your question"`);
console.log(`Ask repo + docs (after indexing a repo):`);
console.log(`  node scripts/ask-across.mjs <repo-slug>,${slug} "your question"`);
