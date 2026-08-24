import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { markdownForPath } from "./markdown.ts";
import { buildLlmsTxt } from "./llms-txt.ts";

describe("markdown negotiation bodies", () => {
  it("serves llms.txt content for markdown negotiation", () => {
    const md = markdownForPath("/llms.txt");
    assert.ok(md);
    assert.equal(md, buildLlmsTxt());
  });
});
