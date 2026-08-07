import { logVerbose } from "../lib/logger.js";
import { apiResponseMetaFromChunkMetadata } from "../enrich/api-response-meta.js";
import type { ApiResponseMeta } from "../enrich/api-response-meta.js";
import { LEDGEINDEX_CHUNKS_INDEX } from "../vector/constants.js";
import { embedQuery } from "../vector/embedding.js";
import { ensureChunksIndex, getVectorStore } from "../vector/store.js";

const PAGE_EXAMPLES_TOP_K = 200;

/** Spoken-locale tags that can collide with example syntax language. */
const LOCALE_LANGUAGE = new Set([
  "en",
  "de",
  "fr",
  "es",
  "it",
  "pt",
  "nl",
  "ja",
  "ko",
  "zh",
  "ru",
  "ar",
  "hi",
  "pl",
  "tr",
  "sv",
  "da",
  "fi",
  "no",
  "cs",
  "hu",
  "ro",
  "uk",
]);

export type PageExample = {
  id: string;
  exampleIndex: number;
  examplePartIndex?: number;
  title: string;
  kind: string;
  language: string | null;
  section: string;
  body: string;
  embedText: string;
  url: string;
  pageSummary: string;
  apiResponse?: ApiResponseMeta | null;
};

export type PageExamplesResult = {
  sourceId: string;
  url: string;
  title: string;
  exampleCount: number;
  examples: PageExample[];
};

/** Prefer dedicated exampleLanguage, then language — skip page-locale tags. */
export function readExampleLanguageFromMetadata(
  metadata: Record<string, unknown>,
): string | null {
  const candidates = [metadata.exampleLanguage, metadata.language];
  for (const raw of candidates) {
    if (typeof raw !== "string") continue;
    const trimmed = raw.trim().toLowerCase();
    if (!trimmed) continue;
    if (LOCALE_LANGUAGE.has(trimmed)) continue;
    return trimmed;
  }
  return null;
}

function toPageExample(result: {
  id?: string;
  metadata?: Record<string, unknown>;
}): PageExample | null {
  const metadata = (result.metadata ?? {}) as Record<string, unknown>;
  if (String(metadata.chunkKind ?? "") !== "example") return null;

  const body = String(metadata.fullBody ?? metadata.body ?? "").trim();
  const embedText = String(metadata.text ?? "").trim();
  if (!body && !embedText) return null;

  const apiResponse = apiResponseMetaFromChunkMetadata(metadata);

  return {
    id: String(result.id ?? ""),
    exampleIndex: Number(metadata.exampleIndex ?? 0),
    ...(metadata.examplePartIndex != null
      ? { examplePartIndex: Number(metadata.examplePartIndex) }
      : {}),
    title: String(metadata.exampleTitle ?? metadata.title ?? "Example"),
    kind: String(metadata.exampleKind ?? "other"),
    language: readExampleLanguageFromMetadata(metadata),
    section: String(metadata.section ?? ""),
    body: body || embedText,
    embedText,
    url: String(metadata.url ?? metadata.parentUrl ?? ""),
    pageSummary: String(metadata.pageSummary ?? ""),
    ...(apiResponse ? { apiResponse } : {}),
  };
}

/** Prefer full example body over split parts; keep highest-coverage row per index. */
function dedupeExamples(examples: PageExample[]): PageExample[] {
  const byIndex = new Map<number, PageExample>();
  for (const example of examples) {
    const existing = byIndex.get(example.exampleIndex);
    if (!existing) {
      byIndex.set(example.exampleIndex, example);
      continue;
    }
    const preferNew =
      example.body.length > existing.body.length ||
      (example.examplePartIndex == null && existing.examplePartIndex != null);
    if (preferNew) {
      byIndex.set(example.exampleIndex, {
        ...example,
        examplePartIndex: undefined,
        language: example.language ?? existing.language,
      });
    } else if (!existing.language && example.language) {
      byIndex.set(example.exampleIndex, {
        ...existing,
        language: example.language,
      });
    }
  }
  return [...byIndex.values()].sort((a, b) => a.exampleIndex - b.exampleIndex);
}

/**
 * Load indexed example chunks for one page URL (preview / debug).
 */
export async function getPageExamples(input: {
  sourceId: string;
  url: string;
}): Promise<PageExamplesResult> {
  const url = input.url.trim();
  await ensureChunksIndex();
  const store = getVectorStore();
  const queryVector = await embedQuery(url || "examples");

  const results = await store.query({
    indexName: LEDGEINDEX_CHUNKS_INDEX,
    queryVector,
    topK: PAGE_EXAMPLES_TOP_K,
    filter: {
      sourceId: input.sourceId,
      url,
      chunkKind: "example",
    },
  });

  const raw: PageExample[] = [];
  let pageTitle = "";
  for (const result of results) {
    const metadata = (result.metadata ?? {}) as Record<string, unknown>;
    if (!pageTitle) {
      const candidate = String(metadata.title ?? "").trim();
      if (candidate) pageTitle = candidate;
    }
    const example = toPageExample(result);
    if (example) raw.push(example);
  }

  const examples = dedupeExamples(raw);
  const title = pageTitle || url;

  logVerbose("Loaded page examples for preview", "PageExamples", {
    sourceId: input.sourceId,
    url,
    exampleCount: examples.length,
    hitCount: results.length,
  });

  return {
    sourceId: input.sourceId,
    url,
    title,
    exampleCount: examples.length,
    examples,
  };
}
