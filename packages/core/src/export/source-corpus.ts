import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getStore } from "../db/index.js";
import {
  listPageSnapshots,
  pageSnapshotUrlKey,
} from "../db/page-snapshots.js";
import { getMetadataCatalog } from "../query/metadata-catalog-store.js";
import type { MetadataCatalogPage } from "../query/metadata-catalog.js";
import {
  listLexicalChunksForSource,
  type LexicalChunkRow,
} from "../query/lexical-store.js";
import { getPageChunks } from "../query/page-chunks.js";
import { getVectorBackend } from "../vector/config.js";

export const SOURCE_CORPUS_EXPORT_FORMAT = "ledgeindex.source-corpus" as const;
export const SOURCE_CORPUS_EXPORT_VERSION = 1 as const;

export type SourceCorpusChunk = {
  id: string;
  chunkIndex: number;
  text: string;
  title: string;
  url: string;
  category: string;
  section: string;
  headingPath: string[];
  chunkKind: string;
  contentType?: string;
  language?: string;
  crawlRoot?: string;
  filePath?: string;
  startLine?: number;
  endLine?: number;
  symbolName?: string;
  symbolKind?: string;
  pageKind?: string;
};

export type SourceCorpusPage = {
  url: string;
  title: string;
  contentHash: string | null;
  category: string;
  crawlRoot: string | null;
  chunkCount: number;
  markdown: string;
  chunks: SourceCorpusChunk[];
};

export type SourceCorpusExport = {
  format: typeof SOURCE_CORPUS_EXPORT_FORMAT;
  formatVersion: typeof SOURCE_CORPUS_EXPORT_VERSION;
  exportedAt: string;
  source: {
    id: string;
    slug: string;
    name: string;
    scope: "personal" | "global";
    hosting: "local" | "cloud";
    canonicalUrl: string | null;
    indexedAt: string | null;
    versionNumber: number;
    versionLabel: string;
    startUrls: string[];
  };
  index: {
    vectorBackend: string;
    catalogUpdatedAt: string;
    pageCount: number;
    chunkCount: number;
  };
  pages: SourceCorpusPage[];
};

export type SourceCorpusExportOptions = {
  /** Include reconstructed Markdown. Defaults to true. */
  includeContent?: boolean;
  includeChunks?: boolean;
};

export type WrittenSourceCorpus = {
  outputDirectory: string;
  manifestPath: string;
  pageFiles: string[];
};

type PageChunkGroup = {
  catalogPage: MetadataCatalogPage;
  chunks: SourceCorpusChunk[];
};

function optionalString(
  metadata: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = metadata[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function optionalNumber(
  metadata: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = metadata[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function toCorpusChunk(row: LexicalChunkRow): SourceCorpusChunk | null {
  const metadata = row.metadata;
  if (String(metadata.chunkKind ?? "") === "example") return null;
  const text = String(metadata.text ?? row.text).trim();
  if (!text) return null;

  const chunkIndex = Number(metadata.chunkIndex ?? 0);
  return {
    id: row.id,
    chunkIndex: Number.isFinite(chunkIndex) ? chunkIndex : 0,
    text,
    title: String(metadata.title ?? ""),
    url: String(metadata.url ?? row.url),
    category: String(metadata.category ?? ""),
    section: String(metadata.section ?? ""),
    headingPath: Array.isArray(metadata.headingPath)
      ? metadata.headingPath.map(String)
      : [],
    chunkKind: String(metadata.chunkKind ?? "markdown"),
    contentType: optionalString(metadata, "contentType"),
    language: optionalString(metadata, "language"),
    crawlRoot: optionalString(metadata, "crawlRoot"),
    filePath: optionalString(metadata, "filePath"),
    startLine: optionalNumber(metadata, "startLine"),
    endLine: optionalNumber(metadata, "endLine"),
    symbolName: optionalString(metadata, "symbolName"),
    symbolKind: optionalString(metadata, "symbolKind"),
    pageKind: optionalString(metadata, "pageKind"),
  };
}

function dedupeAndSortChunks(chunks: SourceCorpusChunk[]): SourceCorpusChunk[] {
  const byIndex = new Map<number, SourceCorpusChunk>();
  for (const chunk of chunks) {
    const existing = byIndex.get(chunk.chunkIndex);
    if (!existing || chunk.text.length > existing.text.length) {
      byIndex.set(chunk.chunkIndex, chunk);
    }
  }
  return [...byIndex.values()].sort((left, right) => {
    if (left.chunkIndex !== right.chunkIndex) {
      return left.chunkIndex - right.chunkIndex;
    }
    return left.id.localeCompare(right.id);
  });
}

function chunksToMarkdown(chunks: SourceCorpusChunk[]): string {
  return chunks
    .map((chunk) => {
      const heading =
        chunk.headingPath.length > 0
          ? `<!-- ${chunk.headingPath.join(" > ")} -->\n`
          : "";
      return `${heading}${chunk.text}`;
    })
    .join("\n\n---\n\n");
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, Math.max(1, items.length)) },
    async () => {
      while (cursor < items.length) {
        const index = cursor++;
        results[index] = await mapper(items[index]!);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

async function loadPageGroups(
  sourceId: string,
  catalogPages: MetadataCatalogPage[],
): Promise<PageChunkGroup[]> {
  const lexicalRows = await listLexicalChunksForSource(sourceId);
  if (lexicalRows.length > 0) {
    const rowsByUrlKey = new Map<string, SourceCorpusChunk[]>();
    for (const row of lexicalRows) {
      const chunk = toCorpusChunk(row);
      if (!chunk) continue;
      const key = pageSnapshotUrlKey(chunk.url);
      const current = rowsByUrlKey.get(key) ?? [];
      current.push(chunk);
      rowsByUrlKey.set(key, current);
    }
    return catalogPages.map((catalogPage) => ({
      catalogPage,
      chunks: dedupeAndSortChunks(
        rowsByUrlKey.get(pageSnapshotUrlKey(catalogPage.url)) ?? [],
      ),
    }));
  }

  return mapWithConcurrency(catalogPages, 6, async (catalogPage) => {
    const result = await getPageChunks({
      sourceId,
      url: catalogPage.url,
    });
    return {
      catalogPage,
      chunks: result.chunks.map((chunk) => ({
        ...chunk,
        chunkKind: "markdown",
      })),
    };
  });
}

export async function exportSourceCorpus(
  sourceId: string,
  options: SourceCorpusExportOptions = {},
): Promise<SourceCorpusExport> {
  const source = await getStore().getSource(sourceId);
  if (!source) throw new Error(`Source not found: ${sourceId}`);

  const catalog = await getMetadataCatalog(sourceId);
  if (!catalog) {
    throw new Error(`Metadata catalog not found for source: ${sourceId}`);
  }

  const snapshots = await listPageSnapshots(sourceId);
  const snapshotsByUrl = new Map(
    snapshots.map((snapshot) => [pageSnapshotUrlKey(snapshot.url), snapshot]),
  );
  const catalogPages = catalog.pages.filter(
    (page) =>
      snapshotsByUrl.get(pageSnapshotUrlKey(page.url))?.tombstonedAt == null,
  );
  const includeContent = options.includeContent ?? true;
  const groups = includeContent
    ? await loadPageGroups(sourceId, catalogPages)
    : catalogPages.map((catalogPage) => ({ catalogPage, chunks: [] }));
  const includeChunks = options.includeChunks ?? true;

  const pages = groups.map(({ catalogPage, chunks }) => {
    const snapshot = snapshotsByUrl.get(pageSnapshotUrlKey(catalogPage.url));
    return {
      url: catalogPage.url,
      title:
        chunks.find((chunk) => chunk.title.trim())?.title.trim() ||
        catalogPage.title,
      contentHash: snapshot?.contentHash || null,
      category: catalogPage.category ?? "",
      crawlRoot: catalogPage.crawlRoot ?? null,
      chunkCount: includeContent ? chunks.length : catalogPage.chunkCount,
      markdown: includeContent ? chunksToMarkdown(chunks) : "",
      chunks: includeContent && includeChunks ? chunks : [],
    };
  });

  return {
    format: SOURCE_CORPUS_EXPORT_FORMAT,
    formatVersion: SOURCE_CORPUS_EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    source: {
      id: source.id,
      slug: source.slug,
      name: source.name,
      scope: source.scope,
      hosting: source.hosting,
      canonicalUrl: source.canonicalUrl ?? null,
      indexedAt: source.indexedAt ?? null,
      versionNumber: source.versionNumber ?? 1,
      versionLabel: source.versionLabel ?? "latest",
      startUrls: [...source.config.startUrls],
    },
    index: {
      vectorBackend: getVectorBackend(),
      catalogUpdatedAt: catalog.updatedAt,
      pageCount: pages.length,
      chunkCount: pages.reduce((sum, page) => sum + page.chunkCount, 0),
    },
    pages,
  };
}

function safePathSegment(segment: string): string {
  const decoded = (() => {
    try {
      return decodeURIComponent(segment);
    } catch {
      return segment;
    }
  })();
  const safe = decoded
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/^\.+$/, "_")
    .trim();
  return safe || "_";
}

function pageFilePath(url: string, used: Set<string>): string {
  let pathname = "/";
  try {
    pathname = new URL(url).pathname;
  } catch {
    pathname = url;
  }
  const segments = pathname.split("/").filter(Boolean).map(safePathSegment);
  const last = segments.at(-1);
  if (!last || !/\.(?:md|mdx)$/i.test(last)) {
    segments.push("index.md");
  } else {
    segments[segments.length - 1] = last.replace(/\.mdx$/i, ".md");
  }

  let relativePath = segments.join("/") || "index.md";
  if (used.has(relativePath.toLowerCase())) {
    const suffix = createHash("sha256").update(url).digest("hex").slice(0, 8);
    relativePath = relativePath.replace(/\.md$/i, `-${suffix}.md`);
  }
  used.add(relativePath.toLowerCase());
  return relativePath;
}

export async function writeSourceCorpusToDirectory(
  corpus: SourceCorpusExport,
  outputDirectory: string,
): Promise<WrittenSourceCorpus> {
  const target = outputDirectory.trim();
  if (!target) throw new Error("outputDirectory is required");

  await mkdir(target, { recursive: true });
  const used = new Set<string>();
  const pageFiles: string[] = [];
  const manifestPages = [];

  for (const page of corpus.pages) {
    const relativePath = pageFilePath(page.url, used);
    const absolutePath = join(target, ...relativePath.split("/"));
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, page.markdown, "utf8");
    pageFiles.push(absolutePath);
    manifestPages.push({
      url: page.url,
      title: page.title,
      filePath: relativePath,
      contentHash: page.contentHash,
      category: page.category,
      crawlRoot: page.crawlRoot,
      chunkCount: page.chunkCount,
    });
  }

  const manifestPath = join(target, "manifest.json");
  await writeFile(
    manifestPath,
    JSON.stringify(
      {
        format: corpus.format,
        formatVersion: corpus.formatVersion,
        exportedAt: corpus.exportedAt,
        source: corpus.source,
        index: corpus.index,
        pages: manifestPages,
      },
      null,
      2,
    ),
    "utf8",
  );

  return { outputDirectory: target, manifestPath, pageFiles };
}
