import assert from "node:assert/strict";
import test from "node:test";
import {
  aggregateRetrievalResults,
  claimIsCovered,
  scoreRetrievedCase,
  urlMatchesExpected,
} from "./evaluate.js";
import type { RetrievalGoldenCase } from "./schemas.js";

const testCase: RetrievalGoldenCase = {
  id: "agent-overview",
  question: "When should I use an agent?",
  category: "agents",
  difficulty: "easy",
  expectUrls: ["/docs/agents/overview"],
  rejectUrls: ["/docs/workflows/overview"],
  requiredClaims: [
    "Agents are useful for open-ended tasks with unknown steps.",
    "Workflows provide explicit control flow.",
  ],
  groundTruth:
    "Agents handle open-ended tasks. Workflows provide explicit control flow.",
  tags: [],
  sourceUrls: ["https://mastra.ai/docs/agents/overview"],
};

test("URL matching treats absolute URLs and rooted paths as exact pages", () => {
  assert.equal(
    urlMatchesExpected("https://mastra.ai/docs", ["https://mastra.ai/docs"]),
    true
  );
  assert.equal(
    urlMatchesExpected("https://mastra.ai/docs/develop", ["/docs"]),
    false
  );
  assert.equal(
    urlMatchesExpected("https://mastra.ai/docs/agents/overview.md", [
      "/docs/agents/overview",
    ]),
    true
  );
});

test("claim coverage tolerates wording while requiring most meaningful terms", () => {
  assert.equal(
    claimIsCovered(
      "Agents are useful for open-ended tasks with unknown steps.",
      "Use agents for open-ended tasks when the steps are not known in advance."
    ),
    true
  );
  assert.equal(
    claimIsCovered(
      "Workflows provide explicit control flow.",
      "This page only discusses vector embeddings."
    ),
    false
  );
});

test("expanded context does not inflate direct page hit metrics", () => {
  const result = scoreRetrievedCase({
    testCase,
    chunks: [
      {
        url: "https://mastra.ai/docs/agents/overview",
        title: "Agents overview",
        text: "Agents are useful for open-ended tasks with unknown steps.",
        score: 0.9,
        retrievalKind: "expanded",
      },
      {
        url: "https://mastra.ai/docs/workflows/overview",
        title: "Workflows",
        text: "Workflows provide explicit control flow.",
        score: 0.8,
        retrievalKind: "direct",
      },
      {
        url: "https://mastra.ai/docs/agents/overview",
        title: "Agents overview",
        text: "Use agents for open-ended tasks when steps are unknown.",
        score: 0.7,
        retrievalKind: "direct",
      },
    ] as never,
    relaxedPassUsed: false,
    weakEvidenceUsed: false,
    pageFilterUsed: false,
    elapsedMs: 12,
  });

  assert.equal(result.metrics.hitAt1, false);
  assert.equal(result.metrics.hitAt3, true);
  assert.equal(result.metrics.reciprocalRank, 0.5);
  assert.equal(result.metrics.rejectHit, true);
  assert.equal(aggregateRetrievalResults([result]).hitAt3Rate, 1);
});
