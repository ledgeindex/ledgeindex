import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { RequestContext } from "@mastra/core/request-context";
import { WORKSPACE_TOOLS } from "@mastra/core/workspace";
import { localAgentSelectionSchema } from "./selection.ts";
import { createReadOnlyWorkspace } from "./workspace.ts";

test("local agent selection accepts source IDs and source sets", () => {
  const sourceId = randomUUID();
  assert.deepEqual(
    localAgentSelectionSchema.parse({
      kind: "sources",
      sourceIds: [sourceId],
    }),
    { kind: "sources", sourceIds: [sourceId] },
  );
  assert.deepEqual(
    localAgentSelectionSchema.parse({
      kind: "source-set",
      sourceSetId: "my-set",
    }),
    { kind: "source-set", sourceSetId: "my-set" },
  );
});

test("local source workspace exposes only read and search tools", async () => {
  const path = join(tmpdir(), `ledgeindex-local-agent-${randomUUID()}`);
  await mkdir(join(path, "content", "docs"), { recursive: true });
  await writeFile(
    join(path, "content", "docs", "index.md"),
    "# Authentication\n\nUse an API key.",
    "utf8",
  );
  await writeFile(join(path, "manifest.json"), '{"private":true}', "utf8");

  const workspace = createReadOnlyWorkspace({
    key: "test-workspace",
    path,
    sourceCount: 1,
    pageCount: 1,
    fileCount: 1,
    byteCount: 33,
    cacheHit: false,
  });

  try {
    const tools = workspace.getToolsConfig();
    assert.equal(tools?.enabled, false);
    assert.equal(
      tools?.[WORKSPACE_TOOLS.FILESYSTEM.READ_FILE]?.enabled,
      true,
    );
    assert.equal(
      tools?.[WORKSPACE_TOOLS.FILESYSTEM.LIST_FILES]?.enabled,
      true,
    );
    assert.equal(tools?.[WORKSPACE_TOOLS.FILESYSTEM.GREP]?.enabled, true);
    assert.equal(tools?.[WORKSPACE_TOOLS.SEARCH.SEARCH]?.enabled, true);
    assert.equal(
      tools?.[WORKSPACE_TOOLS.FILESYSTEM.WRITE_FILE]?.enabled,
      undefined,
    );
    assert.equal(
      tools?.[WORKSPACE_TOOLS.SEARCH.INDEX]?.enabled,
      undefined,
    );

    await workspace.init();
    const filesystem = await workspace.resolveFilesystem({
      requestContext: new RequestContext(),
    });
    assert.ok(filesystem);
    const page = await filesystem.readFile("docs/index.md");
    assert.match(String(page), /Authentication/);
    await assert.rejects(filesystem.readFile("../manifest.json"));
    await assert.rejects(
      filesystem.writeFile("docs/blocked.md", "blocked"),
    );
  } finally {
    await workspace.destroy();
    await rm(path, { recursive: true, force: true });
  }
});
