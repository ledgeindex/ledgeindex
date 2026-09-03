import assert from "node:assert/strict";
import test from "node:test";
import type { Source } from "../db/types.js";
import {
  isIndexedSourceVersion,
  resolveVersionFieldsForCreate,
} from "./source-versioning.js";

function source(
  overrides: Partial<
    Pick<Source, "indexedAt" | "indexStats" | "versionNumber" | "versionLabel">
  > = {},
): Source {
  return {
    id: "source-1",
    projectId: "project-1",
    name: "Docs",
    slug: "docs",
    type: "web_crawl",
    scope: "personal",
    hosting: "local",
    config: {
      startUrls: ["https://example.com/docs"],
      includePatterns: [],
      excludePatterns: [],
      excludeDownloadPatterns: [],
      patternsAreRegex: false,
      renderJs: false,
      useProxy: false,
      enableSitemap: true,
      sitemapOnly: false,
      sitemapUrls: [],
      fileTypes: ["html"],
      contentSelectors: [],
      excludeSelectors: [],
      maxPages: 100,
      userAgent: "test",
    },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

test("an unindexed crawl draft is not an indexed source version", () => {
  assert.equal(isIndexedSourceVersion(source()), false);
});

test("indexed timestamp or stored pages marks a source as indexed", () => {
  assert.equal(
    isIndexedSourceVersion(
      source({ indexedAt: "2026-01-01T00:00:00.000Z" }),
    ),
    true,
  );
  assert.equal(
    isIndexedSourceVersion(
      source({ indexStats: { pageCount: 1, chunkCount: 0 } }),
    ),
    true,
  );
});

test("unindexed drafts do not consume a version number", () => {
  const fields = resolveVersionFieldsForCreate({
    startUrl: "https://example.com/docs",
    familySources: [
      source({ versionNumber: 9, versionLabel: "draft" }),
      source({
        indexedAt: "2026-01-01T00:00:00.000Z",
        versionNumber: 1,
        versionLabel: "v1",
      }),
    ],
  });

  assert.equal(fields.versionNumber, 2);
  assert.equal(fields.versionLabel, "v2");
});
