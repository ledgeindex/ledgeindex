import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { KapaRetrievedChunk } from "./kapa-retrieve.js";
import {
  applyPageKeepDecisions,
  shouldFilterRetrievedPages,
  summarizeRetrievedPages,
} from "./filter-retrieved-pages.js";

function chunk(input: {
  title: string;
  url: string;
  score: number;
  text?: string;
}): KapaRetrievedChunk {
  return {
    id: input.url,
    score: input.score,
    text: input.text ?? input.title,
    url: input.url,
    title: input.title,
    category: "",
    section: "",
    headingPath: [],
    chunkIndex: 0,
    retrievalKind: "direct",
  };
}

describe("shouldFilterRetrievedPages", () => {
  it("runs on a relaxed-pass hit even when the score looks fine", () => {
    assert.equal(
      shouldFilterRetrievedPages({
        relaxedPassUsed: true,
        uniquePageCount: 1,
        maxChunkScore: 0.6,
      }),
      true,
    );
  });

  it("runs when one page would own the answer", () => {
    assert.equal(
      shouldFilterRetrievedPages({
        uniquePageCount: 1,
        maxChunkScore: 0.7,
      }),
      true,
    );
  });

  it("runs after a cascade early-exit", () => {
    assert.equal(
      shouldFilterRetrievedPages({
        cascadePassUsed: true,
        uniquePageCount: 1,
        maxChunkScore: 0.9,
      }),
      true,
    );
  });

  it("runs on a confident multi-page retrieve", () => {
    assert.equal(
      shouldFilterRetrievedPages({
        uniquePageCount: 3,
        maxChunkScore: 0.88,
      }),
      true,
    );
  });

  it("skips only an empty retrieve", () => {
    assert.equal(
      shouldFilterRetrievedPages({
        uniquePageCount: 0,
      }),
      false,
    );
  });
});

describe("applyPageKeepDecisions", () => {
  const convex = chunk({
    title: "Convex vector store",
    url: "https://mastra.ai/reference/vectors/convex",
    score: 0.6,
  });
  const started = chunk({
    title: "Get started",
    url: "https://mastra.ai/docs/getting-started",
    score: 0.44,
  });

  it("drops an off-topic page and keeps the rest", () => {
    const applied = applyPageKeepDecisions([convex, started], [
      { url: convex.url, keep: false, reason: "unrelated API" },
      { url: started.url, keep: true, reason: "product setup" },
    ]);
    assert.deepEqual(
      applied.kept.map((row) => row.title),
      ["Get started"],
    );
    assert.equal(applied.dropped[0]?.title, "Convex vector store");
  });

  it("keeps every chunk when the filter returns no decisions", () => {
    const applied = applyPageKeepDecisions([convex], []);
    assert.deepEqual(applied.kept, [convex]);
    assert.equal(applied.dropped.length, 0);
  });

  it("keeps a page the model forgot to mention", () => {
    const applied = applyPageKeepDecisions([convex, started], [
      { url: convex.url, keep: false, reason: "unrelated API" },
    ]);
    assert.ok(applied.kept.some((row) => row.title === "Get started"));
  });
});

describe("summarizeRetrievedPages", () => {
  it("keeps one row per URL using the highest score", () => {
    const pages = summarizeRetrievedPages([
      chunk({
        title: "Convex vector store",
        url: "https://mastra.ai/reference/vectors/convex",
        score: 0.4,
        text: "intro",
      }),
      chunk({
        title: "Convex vector store",
        url: "https://mastra.ai/reference/vectors/convex",
        score: 0.6,
        text: "Basic Configuration Example",
      }),
    ]);
    assert.equal(pages.length, 1);
    assert.equal(pages[0]?.score, 0.6);
    assert.match(pages[0]?.preview ?? "", /Basic Configuration/);
  });
});
