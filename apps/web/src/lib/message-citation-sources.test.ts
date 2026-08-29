import assert from "node:assert/strict";
import test from "node:test";
import { citationFromWorkspaceReadOutput } from "./message-citation-sources";

test("extracts page citations from Mastra read_file output", () => {
  const output = [
    "ledgeindex/guides/setup-sdk.md (4281 bytes)",
    "     1→---",
    '     2→title: "Set up the SDK"',
    '     3→url: "https://ledgeindex.com/guides/setup-sdk"',
    '     4→source: "LedgeIndex Docs"',
    '     5→source_slug: "ledgeindex"',
    '     6→category: "guides"',
    "     7→---",
    "     8→",
    "     9→# Set up the SDK",
  ].join("\n");

  assert.deepEqual(citationFromWorkspaceReadOutput(output), {
    url: "https://ledgeindex.com/guides/setup-sdk",
    title: "Set up the SDK",
    catalogName: "LedgeIndex Docs",
  });
});

test("ignores workspace reads without page frontmatter", () => {
  assert.equal(
    citationFromWorkspaceReadOutput(
      "ledgeindex/index.md (20 bytes)\n     1→# No metadata",
    ),
    undefined,
  );
});
