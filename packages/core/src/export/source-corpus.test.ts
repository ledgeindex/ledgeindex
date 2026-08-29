import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  SOURCE_CORPUS_EXPORT_FORMAT,
  SOURCE_CORPUS_EXPORT_VERSION,
  sourceCorpusPagesToProfileSeedPages,
  type SourceCorpusExport,
  writeSourceCorpusToDirectory,
} from "./source-corpus.js";

function fixture(): SourceCorpusExport {
  return {
    format: SOURCE_CORPUS_EXPORT_FORMAT,
    formatVersion: SOURCE_CORPUS_EXPORT_VERSION,
    exportedAt: "2026-08-28T20:00:00.000Z",
    source: {
      id: "source-1",
      slug: "mastra",
      name: "Mastra",
      scope: "personal",
      hosting: "local",
      canonicalUrl: "https://mastra.ai/docs",
      indexedAt: "2026-08-28T19:00:00.000Z",
      versionNumber: 1,
      versionLabel: "latest",
      startUrls: ["https://mastra.ai/docs", "https://mastra.ai/reference"],
    },
    index: {
      vectorBackend: "libsql",
      catalogUpdatedAt: "2026-08-28T19:00:00.000Z",
      pageCount: 2,
      chunkCount: 2,
    },
    pages: [
      {
        url: "https://mastra.ai/docs/agents",
        title: "Agents",
        contentHash: "idx:agents",
        category: "docs",
        crawlRoot: "https://mastra.ai/docs",
        chunkCount: 1,
        markdown: "# Agents\n\nBuild an agent.",
        chunks: [],
      },
      {
        url: "https://mastra.ai/reference/core/mastra-class",
        title: "Mastra class",
        contentHash: "idx:class",
        category: "reference",
        crawlRoot: "https://mastra.ai/reference",
        chunkCount: 1,
        markdown: "# Mastra class\n\nAPI reference.",
        chunks: [],
      },
    ],
  };
}

test("writes page markdown and a versioned manifest", async () => {
  const outputDirectory = await mkdtemp(join(tmpdir(), "ledgeindex-corpus-"));
  try {
    const written = await writeSourceCorpusToDirectory(
      fixture(),
      outputDirectory,
    );
    assert.equal(written.pageFiles.length, 2);
    assert.equal(
      await readFile(join(outputDirectory, "docs", "agents", "index.md"), "utf8"),
      "# Agents\n\nBuild an agent.",
    );
    assert.equal(
      await readFile(
        join(
          outputDirectory,
          "reference",
          "core",
          "mastra-class",
          "index.md",
        ),
        "utf8",
      ),
      "# Mastra class\n\nAPI reference.",
    );

    const manifest = JSON.parse(
      await readFile(written.manifestPath, "utf8"),
    ) as {
      format: string;
      formatVersion: number;
      pages: Array<{ filePath: string; contentHash: string }>;
    };
    assert.equal(manifest.format, SOURCE_CORPUS_EXPORT_FORMAT);
    assert.equal(manifest.formatVersion, SOURCE_CORPUS_EXPORT_VERSION);
    assert.deepEqual(
      manifest.pages.map((page) => page.filePath),
      [
        "docs/agents/index.md",
        "reference/core/mastra-class/index.md",
      ],
    );
    assert.deepEqual(
      manifest.pages.map((page) => page.contentHash),
      ["idx:agents", "idx:class"],
    );
  } finally {
    await rm(outputDirectory, { force: true, recursive: true });
  }
});

test("keeps large indexed catalogs available for profile picking", () => {
  const pages = Array.from({ length: 540 }, (_, index) => ({
    ...fixture().pages[0]!,
    url: `https://mastra.ai/docs/page-${index}`,
    title: `Page ${index}`,
  }));

  const seeds = sourceCorpusPagesToProfileSeedPages(pages);

  assert.equal(seeds.length, 540);
  assert.equal(seeds.at(-1)?.title, "Page 539");
});
