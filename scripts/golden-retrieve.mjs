/**
 * Golden-set retrieval eval — LlamaIndex-style pipeline (NL query gen → hybrid per variant → RRF → rerank).
 *
 * Not chat-answer quality. Scores retrieve-only hits vs expected page URLs.
 * (Mastra context scorers measure answer/context with an LLM — use those separately.)
 *
 * Prereq: npm run build -w @ledgeindex/core -w @ledgeindex/docs
 *
 *   LEDGEINDEX_DATA_DIR=ledgeindex-api/.data \
 *     node ledgeindex/scripts/golden-retrieve.mjs \
 *       --golden scripts/golden/mastra.json \
 *       --out results/baseline.json
 *
 *   node ledgeindex/scripts/golden-retrieve.mjs \
 *     --golden scripts/golden/mastra.json \
 *     --compare results/baseline.json
 *
 * Freeze rewrite from a prior run (isolate retrieve-only changes):
 *   node ledgeindex/scripts/golden-retrieve.mjs \
 *     --golden scripts/golden/mastra.json \
 *     --freeze-rewrite results/baseline.json \
 *     --out results/after-rrf.json
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadScriptEnv } from "./load-env.mjs";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const ledgeRoot = resolve(scriptsDir, "..");

function parseArgs(argv) {
  const opts = {
    golden: "scripts/golden/mastra.json",
    out: null,
    compare: null,
    freezeRewrite: null,
    expandPages: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--golden" && argv[i + 1]) opts.golden = argv[++i];
    else if (arg === "--out" && argv[i + 1]) opts.out = argv[++i];
    else if (arg === "--compare" && argv[i + 1]) opts.compare = argv[++i];
    else if (arg === "--freeze-rewrite" && argv[i + 1])
      opts.freezeRewrite = argv[++i];
    else if (arg === "--expand-pages") opts.expandPages = true;
    else if (arg === "--help" || arg === "-h") {
      console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").slice(0, 900));
      process.exit(0);
    }
  }
  return opts;
}

function urlMatches(url, patterns) {
  if (!url || !patterns?.length) return false;
  const lower = url.toLowerCase();
  return patterns.some((p) => lower.includes(String(p).toLowerCase()));
}

function uniquePagesInOrder(chunks) {
  const seen = new Set();
  const pages = [];
  for (const chunk of chunks) {
    const url = chunk.url ?? "";
    if (!url || seen.has(url)) continue;
    seen.add(url);
    pages.push(url);
  }
  return pages;
}

function scoreCase(chunks, caseDef) {
  const urls = chunks.map((c) => c.url ?? "");
  const pages = uniquePagesInOrder(chunks);

  let rank = null;
  for (let i = 0; i < urls.length; i++) {
    if (urlMatches(urls[i], caseDef.expectUrls)) {
      rank = i + 1;
      break;
    }
  }

  const hitAt1 =
    pages.length > 0 && urlMatches(pages[0], caseDef.expectUrls);
  const hitAt3 = pages.slice(0, 3).some((u) => urlMatches(u, caseDef.expectUrls));
  const hitAt5 = pages.slice(0, 5).some((u) => urlMatches(u, caseDef.expectUrls));
  const miss = chunks.length === 0;
  const rejectHit = caseDef.rejectUrls?.some((rej) =>
    chunks.some((c) => urlMatches(c.url, [rej])),
  );

  return {
    hitAt1,
    hitAt3,
    hitAt5,
    rank,
    mrr: rank ? 1 / rank : 0,
    miss,
    rejectHit: Boolean(rejectHit),
    chunkCount: chunks.length,
    topPages: pages.slice(0, 5),
    topChunks: chunks.slice(0, 8).map((c) => ({
      score: c.score,
      url: c.url,
      title: c.title,
    })),
  };
}

function aggregateMetrics(caseResults) {
  const n = caseResults.length;
  const sum = (key) =>
    caseResults.reduce((acc, row) => acc + (row.metrics[key] ? 1 : 0), 0);
  const mrr =
    caseResults.reduce((acc, row) => acc + row.metrics.mrr, 0) / (n || 1);
  return {
    cases: n,
    hitAt1: sum("hitAt1"),
    hitAt3: sum("hitAt3"),
    hitAt5: sum("hitAt5"),
    misses: sum("miss"),
    rejectHits: sum("rejectHit"),
    mrr: Number(mrr.toFixed(4)),
  };
}

function printSummary(label, agg) {
  console.log(
    `${label}: hit@1 ${agg.hitAt1}/${agg.cases} · hit@3 ${agg.hitAt3}/${agg.cases} · hit@5 ${agg.hitAt5}/${agg.cases} · miss ${agg.misses} · reject ${agg.rejectHits} · MRR ${agg.mrr}`,
  );
}

function compareRuns(before, after) {
  console.log("\n--- compare ---");
  const bAgg = before.aggregate;
  const aAgg = after.aggregate;
  printSummary("before", bAgg);
  printSummary("after", aAgg);
  console.log(
    `delta hit@1: ${aAgg.hitAt1 - bAgg.hitAt1} · MRR: ${(aAgg.mrr - bAgg.mrr).toFixed(4)}`,
  );

  const beforeMap = new Map(before.cases.map((c) => [c.id, c]));
  for (const row of after.cases) {
    const prev = beforeMap.get(row.id);
    if (!prev) continue;
    const improved =
      (row.metrics.hitAt1 && !prev.metrics.hitAt1) ||
      (row.metrics.rank &&
        prev.metrics.rank &&
        row.metrics.rank < prev.metrics.rank);
    const regressed =
      (!row.metrics.hitAt1 && prev.metrics.hitAt1) ||
      (row.metrics.rank &&
        prev.metrics.rank &&
        row.metrics.rank > prev.metrics.rank) ||
      (row.metrics.rejectHit && !prev.metrics.rejectHit);
    if (!improved && !regressed) continue;
    const rankStr = (m) =>
      m.rank ? `rank ${m.rank}` : m.miss ? "miss" : "no match";
    const tag = improved ? "↑" : "↓ REGRESSION";
    console.log(
      `  ${tag} ${row.id}: ${rankStr(prev.metrics)} → ${rankStr(row.metrics)}`,
    );
  }
}

async function resolveSourceId(store, golden) {
  if (golden.sourceId) {
    const byId = await store.getSource(golden.sourceId);
    if (byId) return byId.id;
  }
  const slug = golden.sourceSlug?.trim();
  if (!slug) throw new Error("golden file needs sourceId or sourceSlug");
  const sources = await store.listSources();
  const match =
    sources.find((s) => s.slug === slug) ??
    sources.find((s) => s.slug?.includes(slug)) ??
    sources.find((s) =>
      s.name?.toLowerCase().includes(slug.toLowerCase()),
    );
  if (!match) {
    throw new Error(`No source matching slug "${slug}"`);
  }
  return match.id;
}

async function loadModules() {
  const coreDist = resolve(ledgeRoot, "packages/core/dist");
  const docsDist = resolve(ledgeRoot, "packages/docs/dist");
  if (!existsSync(resolve(coreDist, "db/index.js"))) {
    console.error(
      "Missing @ledgeindex/core dist. Run: npm run build -w @ledgeindex/core -w @ledgeindex/docs",
    );
    process.exit(1);
  }
  if (!existsSync(resolve(docsDist, "runtime/retrieval/structured-retrieve.js"))) {
    console.error(
      "Missing @ledgeindex/docs dist. Run: npm run build -w @ledgeindex/core -w @ledgeindex/docs",
    );
    process.exit(1);
  }

  const importDist = (rel) =>
    import(pathToFileURL(resolve(coreDist, rel)).href);

  const { getStore } = await importDist("db/index.js");
  const { runWithRetrievalContext } = await importDist(
    "query/rerank-request-context.js",
  );
  const { resolveRetrievalSettings } = await importDist(
    "query/retrieval-strictness.js",
  );
  const { kapaRetrieveMany } = await importDist("query/kapa-retrieve.js");
  const { retrieveWithStructuredRewriteInContext } = await import(
    pathToFileURL(
      resolve(docsDist, "runtime/retrieval/structured-retrieve.js"),
    ).href,
  );

  return {
    getStore,
    runWithRetrievalContext,
    resolveRetrievalSettings,
    kapaRetrieveMany,
    retrieveWithStructuredRewriteInContext,
  };
}

async function runCase(input) {
  const {
    sourceId,
    caseDef,
    retrievalContext,
    freezeRewrite,
    expandPages,
    runWithRetrievalContext,
    resolveRetrievalSettings,
    kapaRetrieveMany,
    retrieveWithStructuredRewriteInContext,
  } = input;

  if (freezeRewrite?.cases) {
    const frozen = freezeRewrite.cases.find((c) => c.id === caseDef.id);
    if (!frozen?.rewrite) {
      throw new Error(`--freeze-rewrite: no rewrite for case ${caseDef.id}`);
    }
    const rewrite = frozen.rewrite;
    const settings = frozen.settings ?? freezeRewrite.settings ?? {};
    const strictness =
      settings.strictness ?? retrievalContext.retrievalStrictness ?? "strict";
    const resolved = resolveRetrievalSettings({ strictness });

    const retrieval = await runWithRetrievalContext(
      {
        ...retrievalContext,
        retrievalStrictness: strictness,
      },
      () =>
        kapaRetrieveMany({
          queries: rewrite.queries,
          question: caseDef.question,
          sourceId,
          relevanceThreshold: resolved.relevanceThreshold,
          allowWeakEvidence: false,
          expandPages,
        }),
    );

    return {
      chunks: retrieval.merged,
      rewrite,
      mode: "frozen-retrieve",
    };
  }

  const result = await runWithRetrievalContext(retrievalContext, () =>
    retrieveWithStructuredRewriteInContext(
      {
        sourceId,
        question: caseDef.question,
        expandPages,
        history: "(golden eval — no prior messages)",
      },
      retrievalContext,
    ),
  );

  return {
    chunks: result.chunks,
    rewrite: {
      queries: result.rewrite.queries,
      topicScope: result.rewrite.topicScope,
      method: result.rewrite.method,
    },
    mode: "full-pipeline",
    relaxedPassUsed: result.relaxedPassUsed,
    weakEvidenceUsed: result.weakEvidenceUsed,
    rerankBackendUsed: result.rerankBackendUsed,
  };
}

async function main() {
  const opts = parseArgs(process.argv);
  loadScriptEnv();

  const goldenPath = resolve(ledgeRoot, opts.golden);
  const golden = JSON.parse(readFileSync(goldenPath, "utf8"));

  const modules = await loadModules();
  const store = await modules.getStore();
  const sourceId = await resolveSourceId(store, golden);
  const source = await store.getSource(sourceId);

  const strictness = golden.strictness ?? "strict";
  const hosting = golden.hosting === "cloud" ? "cloud" : "local";
  const scope = golden.scope === "global" ? "global" : "personal";

  const retrievalContext = {
    sourceScope: scope,
    sourceHosting: hosting,
    retrievalStrictness: strictness,
  };

  let freezeRewrite = null;
  if (opts.freezeRewrite) {
    const freezePath = resolve(ledgeRoot, opts.freezeRewrite);
    freezeRewrite = JSON.parse(readFileSync(freezePath, "utf8"));
  }

  console.log(`golden: ${opts.golden}`);
  console.log(`data: ${process.env.LEDGEINDEX_DATA_DIR}`);
  console.log(
    `source: ${source?.name ?? sourceId} [${source?.slug ?? ""}] id=${sourceId}`,
  );
  console.log(
    `mode: ${freezeRewrite ? "frozen-retrieve" : "full-pipeline"} · strictness: ${strictness} · expandPages: ${opts.expandPages}`,
  );

  const caseResults = [];
  for (const caseDef of golden.cases) {
    process.stdout.write(`  ${caseDef.id}…`);
    const started = performance.now();
    const run = await runCase({
      sourceId,
      caseDef,
      retrievalContext,
      freezeRewrite,
      expandPages: opts.expandPages,
      ...modules,
    });
    const metrics = scoreCase(run.chunks, caseDef);
    const elapsedMs = Math.round(performance.now() - started);
    process.stdout.write(
      ` ${metrics.hitAt1 ? "hit@1" : metrics.rank ? `rank ${metrics.rank}` : metrics.miss ? "miss" : "—"} (${elapsedMs}ms)\n`,
    );

    caseResults.push({
      id: caseDef.id,
      question: caseDef.question,
      tags: caseDef.tags ?? [],
      expectUrls: caseDef.expectUrls,
      rejectUrls: caseDef.rejectUrls ?? [],
      metrics,
      rewrite: run.rewrite,
      mode: run.mode,
      relaxedPassUsed: run.relaxedPassUsed ?? false,
      weakEvidenceUsed: run.weakEvidenceUsed ?? false,
      rerankBackendUsed: run.rerankBackendUsed ?? null,
      elapsedMs,
    });
  }

  const aggregate = aggregateMetrics(caseResults);
  printSummary("summary", aggregate);

  const payload = {
    generatedAt: new Date().toISOString(),
    golden: opts.golden,
    dataDir: process.env.LEDGEINDEX_DATA_DIR,
    sourceId,
    sourceSlug: source?.slug ?? golden.sourceSlug,
    settings: {
      strictness,
      hosting,
      scope,
      expandPages: opts.expandPages,
    },
    mode: freezeRewrite ? "frozen-retrieve" : "full-pipeline",
    aggregate,
    cases: caseResults,
  };

  if (opts.out) {
    const outPath = resolve(ledgeRoot, opts.out);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, JSON.stringify(payload, null, 2));
    console.log(`written: ${outPath}`);
  }

  if (opts.compare) {
    const comparePath = resolve(ledgeRoot, opts.compare);
    const before = JSON.parse(readFileSync(comparePath, "utf8"));
    compareRuns(before, payload);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
