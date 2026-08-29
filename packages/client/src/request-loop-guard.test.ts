import assert from "node:assert/strict";
import test from "node:test";
import {
  RequestLoopBlockedError,
  RequestLoopGuard,
} from "./request-loop-guard";

function testGuard(): RequestLoopGuard {
  return new RequestLoopGuard({
    maxRequests: 3,
    windowMs: 1_000,
    cooldownMs: 5_000,
    maxEntries: 10,
  });
}

test("blocks repeated requests after the configured threshold", () => {
  const guard = testGuard();
  guard.check("GET /api/sources", 0);
  guard.check("GET /api/sources", 100);
  guard.check("GET /api/sources", 200);

  assert.throws(
    () => guard.check("GET /api/sources", 300),
    RequestLoopBlockedError,
  );
  assert.throws(
    () => guard.check("GET /api/sources", 4_000),
    RequestLoopBlockedError,
  );
  assert.doesNotThrow(() => guard.check("GET /api/sources", 5_301));
});

test("tracks endpoints separately and opens on server rate limits", () => {
  const guard = testGuard();
  guard.check("GET /api/sources", 0);
  assert.doesNotThrow(() => guard.check("GET /api/projects", 100));

  guard.block("GET /api/sources", 200);
  assert.throws(
    () => guard.check("GET /api/sources", 300),
    RequestLoopBlockedError,
  );
  assert.doesNotThrow(() => guard.check("GET /api/projects", 300));
});
