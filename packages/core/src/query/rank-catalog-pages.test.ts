import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { MetadataCatalogPage } from "./metadata-catalog.js";
import {
  mergeRewriteWithCatalogPhrases,
  pickCatalogQueryPhrases,
  resolveCatalogUrlFilter,
} from "./rank-catalog-pages.js";

function page(title: string, url: string): MetadataCatalogPage {
  return { url, title, chunkCount: 1 };
}

const mastraLikePages: MetadataCatalogPage[] = [
  page("Get started", "https://mastra.ai/docs/getting-started"),
  page("Configuration", "https://mastra.ai/docs/server-db/configuration"),
  page("Server on Mastra platform", "https://mastra.ai/docs/deployment/mastra-server"),
  page("Client SDK", "https://mastra.ai/reference/client-js"),
  page("dataset.startExperiment()", "https://mastra.ai/reference/datasets/startExperiment"),
  page("Agents", "https://mastra.ai/docs/agents/overview"),
];

describe("pickCatalogQueryPhrases", () => {
  it("adds Get started for a basic setup question", () => {
    const phrases = pickCatalogQueryPhrases(
      "what is the basic setup",
      mastraLikePages,
    );
    assert.ok(
      phrases.some((phrase) => /get started/i.test(phrase)),
      `expected Get started, got ${JSON.stringify(phrases)}`,
    );
  });

  it("does not force Get started for unrelated questions", () => {
    const phrases = pickCatalogQueryPhrases("what are agents", mastraLikePages);
    assert.ok(!phrases.some((phrase) => /get started/i.test(phrase)));
    assert.ok(phrases.some((phrase) => /agents/i.test(phrase)));
  });

  it("keeps zero-hit URL filter on raw overlap (no Get started for setup)", () => {
    const match = resolveCatalogUrlFilter(
      "what is the basic setup",
      mastraLikePages,
    );
    assert.equal(match, null);
  });
});

describe("mergeRewriteWithCatalogPhrases", () => {
  it("adds one catalog title for single-topic rewrites", () => {
    const merged = mergeRewriteWithCatalogPhrases({
      question: "what is the basic setup",
      rewriteQueries: ["Configuration", "Client SDK"],
      pages: mastraLikePages,
      topicScope: "single",
    });
    assert.deepEqual(merged.queries.slice(0, 2), ["Configuration", "Client SDK"]);
    assert.equal(merged.catalogQueries.length, 1);
    assert.ok(/get started/i.test(merged.catalogQueries[0] ?? ""));
  });

  it("adds one catalog title per multi-topic rewrite query", () => {
    const merged = mergeRewriteWithCatalogPhrases({
      question: "what are agents and how do I use the client sdk",
      rewriteQueries: ["what are agents", "client sdk"],
      pages: mastraLikePages,
      topicScope: "multi",
    });
    assert.equal(merged.catalogQueries.length, 2);
    assert.ok(merged.catalogQueries.some((query) => /agents/i.test(query)));
    assert.ok(merged.catalogQueries.some((query) => /client/i.test(query)));
  });
});
