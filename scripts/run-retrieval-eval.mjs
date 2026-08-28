#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

function parseArgs(argv) {
  const options = {
    golden: "scripts/golden/mastra-50.json",
    out: "results/mastra-50-current.json",
    concurrency: 2,
    expandPages: true,
    profile: "fast",
    scorerModel: "openai/gpt-5.6-luna",
    limit: undefined,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--golden") options.golden = argv[++index];
    else if (arg === "--out") options.out = argv[++index];
    else if (arg === "--concurrency")
      options.concurrency = Number(argv[++index]);
    else if (arg === "--no-expand-pages") options.expandPages = false;
    else if (arg === "--semantic-scorers") options.profile = "pr";
    else if (arg === "--profile") options.profile = argv[++index];
    else if (arg === "--scorer-model") options.scorerModel = argv[++index];
    else if (arg === "--limit") options.limit = Number(argv[++index]);
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));
if (!["fast", "pr", "full"].includes(options.profile)) {
  throw new Error("--profile must be fast, pr, or full");
}
if (options.profile === "pr" && options.limit === undefined) {
  options.limit = 10;
}
const goldenPath = resolve(options.golden);
const outputPath = resolve(options.out);
const golden = JSON.parse(await readFile(goldenPath, "utf8"));

const { bootstrapStandaloneDocsMastra } =
  await import("../packages/docs/dist/runtime/mastra/index.js");
const mastra = bootstrapStandaloneDocsMastra();
const workflow = mastra.getWorkflow("retrievalEvalWorkflow");
const run = await workflow.createRun();
const completed = await run.start({
  inputData: {
    sourceId: golden.sourceId,
    scope: golden.scope ?? "personal",
    hosting: golden.hosting ?? "local",
    strictness: golden.strictness ?? "strict",
    expandPages: options.expandPages,
    concurrency: options.concurrency,
    profile: options.profile,
    scorerModel: options.scorerModel,
    cases:
      options.limit === undefined
        ? golden.cases
        : golden.cases.slice(0, options.limit),
  },
});

if (completed.status !== "success") {
  throw (
    completed.error ??
    new Error(`Retrieval eval ended with ${completed.status}`)
  );
}

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(
  outputPath,
  `${JSON.stringify(completed.result, null, 2)}\n`,
  "utf8"
);

const aggregate = completed.result.aggregate;
console.log(
  JSON.stringify(
    {
      output: outputPath,
      cases: aggregate.cases,
      hitAt1: aggregate.hitAt1Rate,
      hitAt3: aggregate.hitAt3Rate,
      hitAt5: aggregate.hitAt5Rate,
      mrr: aggregate.meanReciprocalRank,
      rejectHitRate: aggregate.rejectHitRate,
      claimCoverage: aggregate.meanClaimCoverage,
      retrievalScores: completed.result.retrievalScoreAggregate,
      answerScores: completed.result.answerScoreAggregate,
    },
    null,
    2
  )
);
