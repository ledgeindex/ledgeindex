import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { MetadataCatalog } from "./metadata-catalog.js";
import { rankPagesForQuestion } from "./rank-catalog-pages.js";
import { formatCatalogForAgent } from "./search-query-planner.js";

describe("formatCatalogForAgent", () => {
  it("keeps the top-ranked page visible when a large catalog is grouped", () => {
    const pages: MetadataCatalog["pages"] = [
      ...Array.from({ length: 100 }, (_, index) => ({
        title: `Reference page ${index}`,
        url: `https://mastra.ai/reference/page-${index}`,
        category: "reference",
        chunkCount: 10,
      })),
      {
        title: "Get started",
        url: "https://mastra.ai/docs",
        category: "docs",
        chunkCount: 1,
      },
    ];
    const rankedPages = rankPagesForQuestion(
      "what is the basic setup",
      pages,
    );
    const catalog: MetadataCatalog = {
      sourceId: "mastra",
      categories: [],
      pages: rankedPages,
      updatedAt: "2026-08-29T00:00:00.000Z",
    };

    const text = formatCatalogForAgent(catalog, {
      charBudget: 1_200,
      preservePageOrder: true,
    });

    assert.match(text, /Get started/);
    assert.match(text, /^## docs/);
  });
});
