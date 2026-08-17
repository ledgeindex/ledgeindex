/**
 * Test coverage grader variance for one question (retrieve once, grade N times).
 *
 *   LEDGEINDEX_DATA_DIR=../ledgeindex-api/.data node scripts/test-coverage-grader.mjs
 */
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import { loadScriptEnv } from "./load-env.mjs";

loadScriptEnv();

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const ledgeRoot = resolve(scriptsDir, "..");
const coreDist = resolve(ledgeRoot, "packages/core/dist");
const docsDist = resolve(ledgeRoot, "packages/docs/dist");

const SOURCE_ID = "6cabf272-42f5-4d48-bf10-cac53fca40de";
const QUESTION = "what are the primitives";
const RUNS = 5;

const importDist = (base, rel) =>
  import(pathToFileURL(resolve(base, rel)).href);

const { runWithRetrievalContext } = await importDist(
  coreDist,
  "query/rerank-request-context.js",
);
const { retrieveWithStructuredRewriteInContext } = await importDist(
  docsDist,
  "runtime/retrieval/structured-retrieve.js",
);
const { assessCoverage } = await importDist(
  docsDist,
  "runtime/retrieval/assess-coverage.js",
);

function scoreSummary(chunks) {
  const scores = chunks.map((c) => c.score).sort((a, b) => b - a);
  const max = scores[0] ?? 0;
  const top3 = scores.slice(0, 3);
  const avgTop3 =
    top3.length ? top3.reduce((s, x) => s + x, 0) / top3.length : 0;
  return { max, avgTop3 };
}

const ctx = {
  sourceScope: "personal",
  sourceHosting: "local",
  retrievalStrictness: "strict",
};

console.log(`data: ${process.env.LEDGEINDEX_DATA_DIR}`);
console.log(`question: ${QUESTION}`);
console.log(`retrieve once, assessCoverage x${RUNS}\n`);

const retrieval = await runWithRetrievalContext(ctx, () =>
  retrieveWithStructuredRewriteInContext(
    {
      sourceId: SOURCE_ID,
      question: QUESTION,
      expandPages: true,
      history: "(test)",
    },
    ctx,
  ),
);

const { max, avgTop3 } = scoreSummary(retrieval.chunks);
console.log(
  `retrieve: ${retrieval.chunks.length} chunks · max ${max.toFixed(2)} · avg top3 ${avgTop3.toFixed(2)}`,
);
console.log(
  `rewrite queries: ${retrieval.rewrite.queries.join(" | ") ?? "—"}`,
);
console.log(
  `top pages: ${[...new Set(retrieval.chunks.map((c) => c.url))].slice(0, 4).join("\n  ")}\n`,
);

for (let i = 1; i <= RUNS; i++) {
  const coverage = await assessCoverage({
    question: QUESTION,
    chunks: retrieval.chunks,
    insufficient: retrieval.insufficient,
    relaxedPassUsed: retrieval.relaxedPassUsed,
    weakEvidenceUsed: retrieval.weakEvidenceUsed,
    maxChunkScore: max,
    avgTop3Score: avgTop3,
  });
  console.log(
    `run ${i}: ${coverage.answerMode} · tier ${coverage.coverageTier} · grader ${coverage.coverageGraderUsed}`,
  );
  if (coverage.coverageReason) {
    console.log(`  ${coverage.coverageReason.slice(0, 120)}`);
  }
}
