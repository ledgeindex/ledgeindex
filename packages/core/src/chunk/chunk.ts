import { MDocument, Language } from "@mastra/rag";

export type ChunkStrategy = "semantic-markdown" | "recursive";

export type ContentChunk = {
  text: string;
  metadata?: Record<string, unknown>;
  tokenCount?: number;
  charCount?: number;
};

/** @deprecated Prefer ContentChunk — alias kept for existing imports. */
export type MarkdownChunk = ContentChunk;

/** Brain semantic-markdown defaults (header-aware, dynamic sizes). */
export const SEMANTIC_MARKDOWN_MAX_SIZE = 1024;
export const SEMANTIC_MARKDOWN_OVERLAP = 150;
export const SEMANTIC_MARKDOWN_JOIN_THRESHOLD = 500;

/** Recursive / code defaults (Mastra recursive + language). */
export const RECURSIVE_CHUNK_MAX_SIZE = 512;
export const RECURSIVE_CHUNK_OVERLAP = 50;

const CHUNK_TIMEOUT_MS = 30_000;

export type ChunkOptions = {
  strategy: ChunkStrategy;
  /** For recursive strategy — e.g. ts, js, python, go. */
  language?: string | null;
  maxSize?: number;
  overlap?: number;
  joinThreshold?: number;
};

function estimateTokenCount(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

/** Map enrich / common language ids onto Mastra Language enum values. */
export function mapToChunkLanguage(
  language?: string | null,
): Language | undefined {
  if (!language?.trim()) return undefined;
  const raw = language.trim().toLowerCase();
  const aliases: Record<string, string> = {
    typescript: "ts",
    javascript: "js",
    node: "js",
    py: "python",
    "c++": "cpp",
    cxx: "cpp",
    "c#": "csharp",
    cs: "csharp",
    sh: "powershell",
    bash: "powershell",
    shell: "powershell",
    zsh: "powershell",
  };
  const normalized = aliases[raw] ?? raw;
  const values = Object.values(Language) as string[];
  if (!values.includes(normalized)) return undefined;
  return normalized as Language;
}

function mapMastraChunks(
  chunks: Array<{ text?: string; metadata?: Record<string, unknown> }>,
): ContentChunk[] {
  return chunks
    .map((chunk) => {
      const text = typeof chunk.text === "string" ? chunk.text.trim() : "";
      const tokenCount =
        typeof chunk.metadata?.tokenCount === "number"
          ? chunk.metadata.tokenCount
          : estimateTokenCount(text);
      return {
        text,
        metadata: chunk.metadata,
        tokenCount,
        charCount: text.length,
      };
    })
    .filter((chunk) => chunk.text.length > 0);
}

/** Char-based splitter when strategy fails or times out. */
export function chunkLocalFallback(
  text: string,
  options?: { maxSize?: number; overlap?: number },
): ContentChunk[] {
  const maxTokens = options?.maxSize ?? SEMANTIC_MARKDOWN_MAX_SIZE;
  const overlapTokens = options?.overlap ?? SEMANTIC_MARKDOWN_OVERLAP;
  const maxChars = maxTokens * 4;
  const overlapChars = overlapTokens * 4;
  const chunks: ContentChunk[] = [];
  let start = 0;

  while (start < text.length) {
    const end = Math.min(start + maxChars, text.length);
    const slice = text.slice(start, end).trim();
    if (slice) {
      chunks.push({
        text: slice,
        charCount: slice.length,
        tokenCount: estimateTokenCount(slice),
      });
    }
    if (end >= text.length) break;
    start = Math.max(0, end - overlapChars);
  }

  return chunks;
}

/** @deprecated Prefer chunkLocalFallback */
export function chunkMarkdownLocalFallback(markdown: string): ContentChunk[] {
  return chunkLocalFallback(markdown, {
    maxSize: SEMANTIC_MARKDOWN_MAX_SIZE,
    overlap: SEMANTIC_MARKDOWN_OVERLAP,
  });
}

async function chunkWithSemanticMarkdown(
  text: string,
  options: ChunkOptions,
): Promise<ContentChunk[]> {
  const doc = MDocument.fromMarkdown(text);
  const chunks = await doc.chunk({
    strategy: "semantic-markdown",
    maxSize: options.maxSize ?? SEMANTIC_MARKDOWN_MAX_SIZE,
    overlap: options.overlap ?? SEMANTIC_MARKDOWN_OVERLAP,
    joinThreshold: options.joinThreshold ?? SEMANTIC_MARKDOWN_JOIN_THRESHOLD,
  });
  return mapMastraChunks(chunks);
}

async function chunkWithRecursive(
  text: string,
  options: ChunkOptions,
): Promise<ContentChunk[]> {
  const doc = MDocument.fromText(text);
  const language = mapToChunkLanguage(options.language);
  const chunks = await doc.chunk({
    strategy: "recursive",
    maxSize: options.maxSize ?? RECURSIVE_CHUNK_MAX_SIZE,
    overlap: options.overlap ?? RECURSIVE_CHUNK_OVERLAP,
    ...(language ? { language } : {}),
  });
  return mapMastraChunks(chunks);
}

/**
 * Unified chunk primitive — strategy mode for docs vs code (and future types).
 */
export async function chunk(
  text: string,
  options: ChunkOptions,
): Promise<ContentChunk[]> {
  const source = text.trim();
  if (!source) return [];

  const run =
    options.strategy === "recursive"
      ? () => chunkWithRecursive(source, options)
      : () => chunkWithSemanticMarkdown(source, options);

  const fallbackMax =
    options.strategy === "recursive"
      ? (options.maxSize ?? RECURSIVE_CHUNK_MAX_SIZE)
      : (options.maxSize ?? SEMANTIC_MARKDOWN_MAX_SIZE);
  const fallbackOverlap =
    options.strategy === "recursive"
      ? (options.overlap ?? RECURSIVE_CHUNK_OVERLAP)
      : (options.overlap ?? SEMANTIC_MARKDOWN_OVERLAP);

  try {
    const chunks = await Promise.race([
      run(),
      new Promise<never>((_, reject) => {
        setTimeout(
          () =>
            reject(new Error(`${options.strategy} chunking timed out`)),
          CHUNK_TIMEOUT_MS,
        );
      }),
    ]);
    if (chunks.length > 0) return chunks;
  } catch {
    // Fall through to local splitter.
  }

  return chunkLocalFallback(source, {
    maxSize: fallbackMax,
    overlap: fallbackOverlap,
  });
}

/**
 * Chunk parsed markdown for indexing (semantic-markdown + local fallback).
 * Thin wrapper over {@link chunk}.
 */
export async function chunkMarkdown(markdown: string): Promise<ContentChunk[]> {
  return chunk(markdown, { strategy: "semantic-markdown" });
}
