import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { detectSystemBrowser } from "./system-browser.ts";

describe("detectSystemBrowser", () => {
  it("returns env override when executable exists", () => {
    const previous = process.env.LEDGEINDEX_CHROME_EXECUTABLE;
    process.env.LEDGEINDEX_CHROME_EXECUTABLE = process.execPath;
    try {
      const found = detectSystemBrowser();
      assert.ok(found);
      assert.equal(found?.path, process.execPath);
    } finally {
      if (previous === undefined) {
        delete process.env.LEDGEINDEX_CHROME_EXECUTABLE;
      } else {
        process.env.LEDGEINDEX_CHROME_EXECUTABLE = previous;
      }
    }
  });
});
