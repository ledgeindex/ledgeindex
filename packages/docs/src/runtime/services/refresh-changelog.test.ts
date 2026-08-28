import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { hashPageContent } from "../db/page-snapshots.ts";
import {
  INDEXED_CONTENT_HASH_PREFIX,
  buildRefreshChangelog,
  pageRefreshUrlKey,
  refreshDeleteUrls,
} from "./refresh-changelog.ts";

const oldHash = `${INDEXED_CONTENT_HASH_PREFIX}${hashPageContent("week old getting started")}`;
const newHash = `${INDEXED_CONTENT_HASH_PREFIX}${hashPageContent("Create your first agent with a single command")}`;
const liveBody = "Create your first agent with a single command";
const poisonedLiveHash = hashPageContent(liveBody);

describe("buildRefreshChangelog", () => {
  it("marks overlapping pages as updated when no content hash exists", () => {
    const changelog = buildRefreshChangelog({
      catalogPages: [{ url: "https://mastra.ai/docs", title: "Docs" }],
      incoming: [
        {
          url: "https://mastra.ai/docs/",
          title: "Docs",
          contentHash: newHash,
        },
      ],
      existingSnapshots: [],
    });

    assert.equal(changelog.updated.length, 1);
    assert.equal(changelog.unchangedCount, 0);
    assert.equal(changelog.baselineCaptured, false);
    assert.equal(changelog.updated[0]?.url, "https://mastra.ai/docs/");
  });

  it("treats a crawl hash that was never written at index time as a false match", () => {
    const changelog = buildRefreshChangelog({
      catalogPages: [{ url: "https://mastra.ai/docs", title: "Get started" }],
      incoming: [
        {
          url: "https://mastra.ai/docs",
          title: "Get started",
          contentHash: `${INDEXED_CONTENT_HASH_PREFIX}${poisonedLiveHash}`,
        },
      ],
      existingSnapshots: [
        {
          url: "https://mastra.ai/docs",
          contentHash: poisonedLiveHash,
          tombstonedAt: null,
        },
      ],
    });

    assert.equal(changelog.updated.length, 1);
    assert.equal(changelog.unchangedCount, 0);
  });

  it("detects a body edit when the URL is already indexed", () => {
    const changelog = buildRefreshChangelog({
      catalogPages: [{ url: "https://mastra.ai/en/docs", title: "Get started" }],
      incoming: [
        {
          url: "https://www.mastra.ai/en/docs",
          title: "Get started",
          contentHash: newHash,
        },
      ],
      existingSnapshots: [
        {
          url: "https://mastra.ai/en/docs/",
          contentHash: oldHash,
          tombstonedAt: null,
        },
      ],
    });

    assert.equal(changelog.updated.length, 1);
    assert.equal(changelog.added.length, 0);
    assert.equal(changelog.unchangedCount, 0);
  });

  it("keeps a page unchanged only when the indexed hash still matches", () => {
    const changelog = buildRefreshChangelog({
      catalogPages: [{ url: "https://mastra.ai/docs", title: "Docs" }],
      incoming: [
        { url: "https://mastra.ai/docs", title: "Docs", contentHash: oldHash },
      ],
      existingSnapshots: [
        {
          url: "https://mastra.ai/docs",
          contentHash: oldHash,
          tombstonedAt: null,
        },
      ],
    });

    assert.equal(changelog.updated.length, 0);
    assert.equal(changelog.unchangedCount, 1);
  });

  it("lists pages that left the live crawl as removed", () => {
    const changelog = buildRefreshChangelog({
      catalogPages: [
        { url: "https://mastra.ai/docs", title: "Docs" },
        { url: "https://mastra.ai/old", title: "Old" },
      ],
      incoming: [
        { url: "https://mastra.ai/docs", title: "Docs", contentHash: oldHash },
      ],
      existingSnapshots: [
        {
          url: "https://mastra.ai/docs",
          contentHash: oldHash,
          tombstonedAt: null,
        },
      ],
    });

    assert.equal(changelog.removed.length, 1);
    assert.equal(changelog.removed[0]?.url, "https://mastra.ai/old");
  });
});

describe("pageRefreshUrlKey", () => {
  it("treats slash and www as the same page", () => {
    assert.equal(
      pageRefreshUrlKey("https://www.mastra.ai/docs/"),
      pageRefreshUrlKey("https://mastra.ai/docs"),
    );
  });
});

describe("refreshDeleteUrls", () => {
  it("includes the indexed URL when it differs from the live URL", () => {
    const urls = refreshDeleteUrls({
      baselineCaptured: false,
      unchangedCount: 0,
      added: [],
      removed: [],
      updated: [
        {
          url: "https://mastra.ai/docs/",
          title: "Docs",
          indexedUrl: "https://mastra.ai/docs",
        },
      ],
    });
    assert.deepEqual(urls.sort(), [
      "https://mastra.ai/docs",
      "https://mastra.ai/docs/",
    ]);
  });
});
