import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  appendCatalogCandidates,
  ensurePerQueryWinners,
  type FusedQueryResult,
} from "./hybrid-fuse.js";

function hit(id: string): FusedQueryResult {
  return { id, score: 1, metadata: {} };
}

describe("ensurePerQueryWinners", () => {
  it("keeps a query's top hit when RRF dropped it from the merged pool", () => {
    const getStarted = hit("get-started");
    const convex = hit("convex");
    const other = Array.from({ length: 3 }, (_, index) => hit(`other-${index}`));
    const merged = [convex, ...other];
    const kept = ensurePerQueryWinners(
      [[convex], [getStarted]],
      merged,
      4,
    );
    assert.ok(kept.some((row) => row.id === "get-started"));
    assert.equal(kept.length, 4);
  });

  it("does not duplicate a winner already in the merged pool", () => {
    const convex = hit("convex");
    const kept = ensurePerQueryWinners([[convex], [convex]], [convex], 4);
    assert.equal(kept.filter((row) => row.id === "convex").length, 1);
  });
});

describe("appendCatalogCandidates", () => {
  it("keeps every fusion candidate and appends the catalog page's best chunks", () => {
    const fusion = Array.from({ length: 4 }, (_, index) => hit(`fusion-${index}`));
    const catalog = [hit("catalog-0"), hit("catalog-1"), hit("catalog-2")];

    const pool = appendCatalogCandidates(fusion, catalog, 2);

    assert.deepEqual(pool.slice(0, 4), fusion);
    assert.deepEqual(
      pool.slice(4).map((row) => row.id),
      ["catalog-0", "catalog-1"],
    );
  });

  it("does not re-add a catalog chunk fusion already found", () => {
    const shared = hit("shared");
    const pool = appendCatalogCandidates([shared], [shared, hit("extra")], 4);

    assert.deepEqual(
      pool.map((row) => row.id),
      ["shared", "extra"],
    );
  });

  it("returns the fusion pool untouched when there is nothing to recover", () => {
    const fusion = [hit("a"), hit("b")];

    assert.equal(appendCatalogCandidates(fusion, [], 4), fusion);
    assert.equal(appendCatalogCandidates(fusion, [hit("c")], 0), fusion);
  });
});
