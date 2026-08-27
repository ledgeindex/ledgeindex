import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isDirectHit,
  pageTitleMatchesCatalog,
  rescueCatalogAlignedHits,
  type KapaRetrievedChunk,
} from "./kapa-retrieve.js";
import {
  PAGE_EXPANSION_WEAK_MAX_CHUNKS,
  PAGE_EXPANSION_WEAK_NEIGHBOUR_RADIUS,
  RELEVANCE_THRESHOLD,
} from "../vector/constants.js";

function chunk(input: {
  title: string;
  url: string;
  score: number;
}): KapaRetrievedChunk {
  return {
    id: input.url,
    score: input.score,
    text: input.title,
    url: input.url,
    title: input.title,
    category: "",
    section: "",
    headingPath: [],
    chunkIndex: 0,
    retrievalKind: "direct",
  };
}

describe("isDirectHit", () => {
  it("treats reranked chunks as evidence", () => {
    assert.equal(isDirectHit({ retrievalKind: "direct" }), true);
  });

  it("treats page-expansion siblings as non-evidence", () => {
    assert.equal(isDirectHit({ retrievalKind: "expanded" }), false);
  });

  it("defaults to evidence for chunks from paths that predate the tag", () => {
    assert.equal(isDirectHit({}), true);
  });
});

/**
 * The expansion gate lives inside `expandTopPages`, which needs a live vector
 * store. These cases pin the decision itself so the inversion cannot come back:
 * a sole surviving page is exactly what a barely passing relaxed retrieve looks
 * like, so page count alone must never authorise a full page slice.
 */
describe("concentrated expansion gate", () => {
  const allowConcentrated = (input: {
    weakEvidenceUsed: boolean;
    anchorTopScore: number;
  }) => !input.weakEvidenceUsed && input.anchorTopScore >= RELEVANCE_THRESHOLD;

  it("allows a page slice when the anchor cleared the strict threshold", () => {
    assert.equal(
      allowConcentrated({ weakEvidenceUsed: false, anchorTopScore: 0.71 }),
      true,
    );
  });

  it("refuses a page slice for a relaxed-pass anchor", () => {
    assert.equal(
      allowConcentrated({ weakEvidenceUsed: false, anchorTopScore: 0.6 }),
      false,
    );
  });

  it("refuses a page slice when only weak evidence survived", () => {
    assert.equal(
      allowConcentrated({ weakEvidenceUsed: true, anchorTopScore: 0.9 }),
      false,
    );
  });

  it("keeps the weak-anchor window narrow", () => {
    assert.ok(PAGE_EXPANSION_WEAK_NEIGHBOUR_RADIUS >= 1);
    assert.ok(PAGE_EXPANSION_WEAK_MAX_CHUNKS < 8);
  });
});

describe("rescueCatalogAlignedHits", () => {
  const convex = chunk({
    title: "Convex vector store",
    url: "https://mastra.ai/reference/vectors/convex",
    score: 0.6,
  });
  const getStarted = chunk({
    title: "Get started",
    url: "https://mastra.ai/docs/getting-started",
    score: 0.44,
  });

  it("matches catalog titles without forcing an exact string", () => {
    assert.equal(pageTitleMatchesCatalog("Get started", ["Get started"]), true);
    assert.equal(
      pageTitleMatchesCatalog("Convex vector store", ["Get started"]),
      false,
    );
  });

  it("adds the catalog page when one other URL is the only survivor", () => {
    const rescued = rescueCatalogAlignedHits({
      directHits: [convex],
      reranked: [convex, getStarted],
      catalogQueries: ["Get started"],
      minScore: 0.35,
    });
    assert.equal(rescued.length, 2);
    assert.ok(rescued.some((row) => row.title === "Get started"));
    assert.equal(rescued[0]?.title, "Convex vector store");
  });

  it("does not replace the reranker winner", () => {
    const rescued = rescueCatalogAlignedHits({
      directHits: [convex],
      reranked: [getStarted, convex],
      catalogQueries: ["Get started"],
      minScore: 0.35,
    });
    assert.equal(rescued[0]?.url, convex.url);
  });

  it("does not invent a catalog page the reranker never scored", () => {
    const rescued = rescueCatalogAlignedHits({
      directHits: [convex],
      reranked: [convex],
      catalogQueries: ["Get started"],
      minScore: 0.35,
    });
    assert.deepEqual(rescued, [convex]);
  });

  it("does not rescue a catalog page the reranker scored as junk", () => {
    const rescued = rescueCatalogAlignedHits({
      directHits: [convex],
      reranked: [convex, { ...getStarted, score: 0.12 }],
      catalogQueries: ["Get started"],
      minScore: 0.35,
    });
    assert.deepEqual(rescued, [convex]);
  });

  it("does nothing when a catalog page already survived", () => {
    const rescued = rescueCatalogAlignedHits({
      directHits: [getStarted],
      reranked: [getStarted, convex],
      catalogQueries: ["Get started"],
      minScore: 0.35,
    });
    assert.deepEqual(rescued, [getStarted]);
  });
});
