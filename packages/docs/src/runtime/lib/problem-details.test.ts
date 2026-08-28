import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildProblemDetails } from "./problem-details.ts";

describe("RFC 9457 problem details", () => {
  it("includes type, title, status, detail, and code", () => {
    const problem = buildProblemDetails({
      status: 401,
      code: "UNAUTHORIZED",
      detail: "Authentication required",
    });
    assert.equal(problem.type, "https://ledgeindex.com/problems/unauthorized");
    assert.equal(problem.title, "Unauthorized");
    assert.equal(problem.status, 401);
    assert.equal(problem.detail, "Authentication required");
    assert.equal(problem.code, "UNAUTHORIZED");
    assert.equal(problem.error, "Authentication required");
  });
});
