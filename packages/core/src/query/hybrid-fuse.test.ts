import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
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
