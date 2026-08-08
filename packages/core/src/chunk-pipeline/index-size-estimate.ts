import {
  SEMANTIC_MARKDOWN_MAX_SIZE,
  SEMANTIC_MARKDOWN_OVERLAP,
} from "./chunk-markdown.js";

/** Fast upper-bound style estimate — no semantic chunking, matches local fallback splitter. */
export function estimateChunkCountFromMarkdown(markdown: string): number {
  const source = markdown.trim();
  if (!source) return 0;

  const maxChars = SEMANTIC_MARKDOWN_MAX_SIZE * 4;
  const overlapChars = SEMANTIC_MARKDOWN_OVERLAP * 4;
  let count = 0;
  let start = 0;

  while (start < source.length) {
    const end = Math.min(start + maxChars, source.length);
    const text = source.slice(start, end).trim();
    if (text) count += 1;
    if (end >= source.length) break;
    start = Math.max(0, end - overlapChars);
  }

  return count;
}

export type IndexSizePageEstimate = {
  url: string;
  title: string;
  charCount: number;
  estimatedChunks: number;
  error?: string;
};

export type IndexSizeEstimate = {
  pages: IndexSizePageEstimate[];
  parsedCount: number;
  failedCount: number;
  totalEstimatedChunks: number;
  avgChunksPerPage: number;
  selectedUrlCount: number;
  extrapolatedTotalChunks: number | null;
};

export function buildIndexSizeEstimate(
  pages: IndexSizePageEstimate[],
  selectedUrlCount: number,
): IndexSizeEstimate {
  const parsed = pages.filter((page) => !page.error && page.estimatedChunks > 0);
  const failedCount = pages.filter((page) => page.error).length;
  const totalEstimatedChunks = parsed.reduce(
    (sum, page) => sum + page.estimatedChunks,
    0,
  );
  const avgChunksPerPage =
    parsed.length > 0 ? totalEstimatedChunks / parsed.length : 0;

  const extrapolatedTotalChunks =
    selectedUrlCount > parsed.length && parsed.length > 0
      ? Math.round(avgChunksPerPage * selectedUrlCount)
      : null;

  return {
    pages: [...pages].sort((a, b) => b.estimatedChunks - a.estimatedChunks),
    parsedCount: parsed.length,
    failedCount,
    totalEstimatedChunks,
    avgChunksPerPage,
    selectedUrlCount,
    extrapolatedTotalChunks,
  };
}
