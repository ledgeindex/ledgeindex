import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SourceCorpusPage } from "@ledgeindex/core/export/source-corpus.js";
import { corpusPagesToSeedPages } from "./profile-indexed-source.js";

function page(index: number): SourceCorpusPage {
  return {
    url: `https://example.com/docs/${index}`,
    title: `Page ${index}`,
    contentHash: null,
    category: "docs",
    crawlRoot: "https://example.com/docs",
    chunkCount: 0,
    markdown: "x".repeat(20),
    chunks: [],
  };
}

describe("corpusPagesToSeedPages", () => {
  it("caps pages and markdown for profile seed limits", () => {
    const seeds = corpusPagesToSeedPages(
      [page(1), page(2), page(3)],
      { maxSeedPages: 2, maxMarkdownChars: 8 },
    );

    assert.equal(seeds.length, 2);
    assert.equal(seeds[0]?.markdown, "xxxxxxxx");
    assert.equal(seeds[1]?.url, "https://example.com/docs/2");
  });
});
