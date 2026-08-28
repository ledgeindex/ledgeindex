#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const sourceId = option("--source", "");
const count = Number(option("--count", "50"));
const outputPath = resolve(
  option("--out", `scripts/golden/generated-${Date.now()}.json`)
);
if (!sourceId) {
  throw new Error("Pass --source <source-id>");
}

const { bootstrapStandaloneDocsMastra } =
  await import("../packages/docs/dist/runtime/mastra/index.js");
const mastra = bootstrapStandaloneDocsMastra();
const workflow = mastra.getWorkflow("generateRetrievalGoldenSetWorkflow");
const run = await workflow.createRun();
const completed = await run.start({
  inputData: { sourceId, count },
});

if (completed.status !== "success") {
  throw (
    completed.error ??
    new Error(`Golden generation ended with ${completed.status}`)
  );
}

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(
  outputPath,
  `${JSON.stringify(completed.result, null, 2)}\n`,
  "utf8"
);
console.log(
  JSON.stringify(
    {
      output: outputPath,
      cases: completed.result.cases.length,
      reviewStatus: completed.result.reviewStatus,
    },
    null,
    2
  )
);
