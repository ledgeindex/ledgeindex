import { logVerbose } from "../lib/logger.js";
import { LEDGEINDEX_CHUNKS_INDEX } from "../vector/constants.js";
import { embedQuery } from "../vector/embedding.js";
import { ensureChunksIndex, getVectorStore } from "../vector/store.js";

const PAGE_CHUNKS_TOP_K = 200;

export type PageChunk = {
  id: string;
  chunkIndex: number;
  text: string;
  title: string;
  url: string;
  category: string;
  section: string;
  headingPath: string[];
};

export type PageChunksResult = {
  sourceId: string;
  url: string;
  title: string;
  chunkCount: number;
  chunks: PageChunk[];
  /** Chunk texts joined in chunkIndex order (overlap may repeat). */
  markdown: string;
};

function toPageChunk(result: {
  id?: string;
  metadata?: Record<string, unknown>;
}): PageChunk | null {
  const metadata = (result.metadata ?? {}) as Record<string, unknown>;
  const text = String(metadata.text ?? "").trim();
  if (!text) return null;

  const headingPath = Array.isArray(metadata.headingPath)
    ? metadata.headingPath.map(String)
    : [];

  return {
    id: String(result.id ?? ""),
    chunkIndex: Number(metadata.chunkIndex ?? 0),
    text,
    title: String(metadata.title ?? ""),
    url: String(metadata.url ?? ""),
    category: String(metadata.category ?? ""),
    section: String(metadata.section ?? ""),
    headingPath,
  };
}

/**
 * Load indexed chunk text for one page URL (debug / MD preview).
 * Uses a filtered vector query — same store path as page expansion.
 */
export async function getPageChunks(input: {
  sourceId: string;
  url: string;
}): Promise<PageChunksResult> {
  const url = input.url.trim();
  await ensureChunksIndex();
  const store = getVectorStore();
  const queryVector = await embedQuery(url || "documentation");

  const results = await store.query({
    indexName: LEDGEINDEX_CHUNKS_INDEX,
    queryVector,
    topK: PAGE_CHUNKS_TOP_K,
    filter: { sourceId: input.sourceId, url },
  });

  const byIndex = new Map<number, PageChunk>();
  for (const result of results) {
    const metadata = (result.metadata ?? {}) as Record<string, unknown>;
    // Example chunks have their own preview path (getPageExamples).
    if (String(metadata.chunkKind ?? "") === "example") continue;

    const chunk = toPageChunk(result);
    if (!chunk) continue;
    const existing = byIndex.get(chunk.chunkIndex);
    if (!existing || chunk.text.length > existing.text.length) {
      byIndex.set(chunk.chunkIndex, chunk);
    }
  }

  const chunks = [...byIndex.values()].sort(
    (a, b) => a.chunkIndex - b.chunkIndex,
  );

  const title =
    chunks.find((chunk) => chunk.title.trim())?.title.trim() || url;

  const markdown = chunks
    .map((chunk) => {
      const heading =
        chunk.headingPath.length > 0
          ? `<!-- ${chunk.headingPath.join(" > ")} -->\n`
          : "";
      return `${heading}${chunk.text}`;
    })
    .join("\n\n---\n\n");

  logVerbose("Loaded page chunks for preview", "PageChunks", {
    sourceId: input.sourceId,
    url,
    chunkCount: chunks.length,
    hitCount: results.length,
  });

  return {
    sourceId: input.sourceId,
    url,
    title,
    chunkCount: chunks.length,
    chunks,
    markdown,
  };
}
