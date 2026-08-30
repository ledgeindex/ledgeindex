import assert from "node:assert/strict";
import test from "node:test";
import { rankChunksByPageEvidence } from "./page-evidence-rank.js";

function chunk(
  id: string,
  url: string,
  score: number,
  retrievalKind: "direct" | "expanded" = "direct"
) {
  return { id, url, score, retrievalKind };
}

test("corroborating chunks can promote a stronger page", () => {
  const ranking = rankChunksByPageEvidence([
    chunk("specific", "https://docs.test/sdk-setup", 0.91),
    chunk("main-1", "https://docs.test/get-started", 0.87),
    chunk("main-2", "https://docs.test/get-started", 0.84),
    chunk("main-3", "https://docs.test/get-started", 0.8),
  ]);

  assert.equal(ranking.pages[0]?.url, "https://docs.test/get-started");
  assert.equal(ranking.anchor?.url, "https://docs.test/get-started");
  assert.deepEqual(
    ranking.chunks.slice(0, 3).map((entry) => entry.id),
    ["main-1", "main-2", "main-3"]
  );
});

test("does not force an anchor when page evidence is nearly tied", () => {
  const chunks = [
    chunk("one", "https://docs.test/one", 0.9),
    chunk("two", "https://docs.test/two", 0.88),
  ];
  const ranking = rankChunksByPageEvidence(chunks);

  assert.equal(ranking.anchor, null);
  assert.deepEqual(ranking.chunks, chunks);
});

test("preserves reranker order when corroboration has only a narrow lead", () => {
  const chunks = [
    chunk("platform", "https://docs.test/platform", 0.9069),
    chunk("adapters-low", "https://docs.test/adapters", 0.741),
    chunk("adapters-high", "https://docs.test/adapters", 0.8501),
  ];
  const ranking = rankChunksByPageEvidence(chunks);

  assert.equal(ranking.pages[0]?.url, "https://docs.test/adapters");
  assert.equal(ranking.anchor, null);
  assert.deepEqual(ranking.chunks, chunks);
});

test("expanded chunks cannot create or strengthen an anchor", () => {
  const ranking = rankChunksByPageEvidence([
    chunk("direct-a", "https://docs.test/a", 0.8),
    chunk("expanded-a", "https://docs.test/a", 0.99, "expanded"),
    chunk("direct-b", "https://docs.test/b", 0.79),
  ]);

  assert.equal(ranking.pages[0]?.score, 0.8);
  assert.equal(ranking.anchor, null);
});
