import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  formatRateLimitHeader,
  formatRateLimitPolicyHeader,
  stripV1Prefix,
} from "./api-conventions.ts";

describe("API version prefix", () => {
  it("strips /v1 for routing", () => {
    assert.equal(stripV1Prefix("/v1"), "/");
    assert.equal(stripV1Prefix("/v1/health"), "/health");
    assert.equal(stripV1Prefix("/v1/openapi.json"), "/openapi.json");
    assert.equal(stripV1Prefix("/v1?x=1"), "/?x=1");
    assert.equal(stripV1Prefix("/health"), "/health");
    assert.equal(stripV1Prefix("/v10/health"), "/v10/health");
  });
});

describe("rate limit header format", () => {
  it("uses IETF RateLimit structured fields", () => {
    assert.equal(
      formatRateLimitHeader({ limit: 120, remaining: 119, resetSeconds: 58 }),
      "limit=120, remaining=119, reset=58",
    );
    assert.equal(
      formatRateLimitPolicyHeader({ limit: 120, windowSeconds: 60 }),
      "120;w=60",
    );
  });
});
