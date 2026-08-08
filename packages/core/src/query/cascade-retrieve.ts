import type { QueryResult } from "@mastra/core/vector";
import { logVerbose } from "../lib/logger.js";
import {
  CASCADE_RETRIEVE_TOP_K,
  CASCADE_VECTOR_MIN_SCORE,
  LEDGEINDEX_CHUNKS_INDEX,
} from "../vector/constants.js";
import { embedQuery } from "../vector/embedding.js";
import { ensureChunksIndex, getVectorStore } from "../vector/store.js";
import {
  type KapaRetrievedChunk,
  type KapaRetrieveFilter,
} from "./kapa-retrieve.js";

/**
 * Cascade / Adaptive RAG — cheap vector peek before rewrite + rerank.
 *
 * Env:
 * - `LEDGEINDEX_CASCADE_RETRIEVE` — `1`/`true`/`on` to enable (default **off**)
 * - `LEDGEINDEX_CASCADE_VECTOR_MIN` — min raw vector score to early-exit (default 0.80)
 * - `LEDGEINDEX_CASCADE_TOP_K` — how many chunks to keep on hit (default 3)
 */

export type CascadeRetrieveResult = {
  chunks: KapaRetrievedChunk[];
  topScore: number;
  candidateCount: number;
  reason: string;
};

function envFlagOn(raw: string | undefined, defaultOn: boolean): boolean {
  const value = raw?.trim().toLowerCase();
  if (!value) return defaultOn;
  if (value === "0" || value === "false" || value === "off" || value === "no") {
    return false;
  }
  if (value === "1" || value === "true" || value === "on" || value === "yes") {
    return true;
  }
  return defaultOn;
}

export function isCascadeRetrieveEnabled(
  raw = process.env.LEDGEINDEX_CASCADE_RETRIEVE,
): boolean {
  return envFlagOn(raw, false);
}

export function getCascadeVectorMinScore(
  raw = process.env.LEDGEINDEX_CASCADE_VECTOR_MIN,
): number {
  if (!raw?.trim()) return CASCADE_VECTOR_MIN_SCORE;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return CASCADE_VECTOR_MIN_SCORE;
  return Math.min(1, Math.max(0, parsed));
}

export function getCascadeTopK(
  raw = process.env.LEDGEINDEX_CASCADE_TOP_K,
): number {
  if (!raw?.trim()) return CASCADE_RETRIEVE_TOP_K;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return CASCADE_RETRIEVE_TOP_K;
  return Math.min(8, Math.max(1, Math.floor(parsed)));
}

/** Pure gate: accept when top raw vector score clears the bar. */
export function shouldAcceptCascadeVectorHit(
  scores: number[],
  minScore = getCascadeVectorMinScore(),
): boolean {
  const top = scores[0] ?? 0;
  return top >= minScore;
}

function normalizePathPrefix(url: string): string {
  try {
    const parsed = new URL(url.trim());
    parsed.hash = "";
    parsed.search = "";
    const pathname = parsed.pathname.replace(/\/+$/, "") || "/";
    parsed.pathname = pathname;
    return parsed.toString().replace(/\/$/, pathname === "/" ? "/" : "");
  } catch {
    return url.trim().replace(/\/+$/, "");
  }
}

function urlMatchesPathPrefix(pageUrl: string, pathStartUrl: string): boolean {
  const root = normalizePathPrefix(pathStartUrl);
  if (!root) return true;
  try {
    const page = new URL(pageUrl);
    const base = new URL(root);
    if (page.origin !== base.origin) return false;
    const pagePath = page.pathname.replace(/\/+$/, "") || "/";
    const rootPath = base.pathname.replace(/\/+$/, "") || "/";
    if (rootPath === "/") return true;
    return pagePath === rootPath || pagePath.startsWith(`${rootPath}/`);
  } catch {
    return pageUrl.startsWith(root);
  }
}

function toChunk(result: QueryResult, score: number): KapaRetrievedChunk {
  const metadata = (result.metadata ?? {}) as Record<string, unknown>;
  const headingPath = Array.isArray(metadata.headingPath)
    ? metadata.headingPath.map(String)
    : [];

  return {
    id: String(result.id ?? ""),
    score,
    text: String(metadata.text ?? ""),
    url: String(metadata.url ?? ""),
    title: String(metadata.title ?? ""),
    category: String(metadata.category ?? ""),
    section: String(metadata.section ?? ""),
    headingPath,
    chunkIndex: Number(metadata.chunkIndex ?? 0),
    details: undefined,
  };
}

/**
 * Stage-1 cascade: tiny vector search on the **original** question.
 * Returns chunks when top score is high enough — caller should skip rewrite + rerank.
 * Returns null when disabled, empty, or below the confidence bar (fall through).
 */
export async function tryCascadeRetrieve(input: {
  query: string;
  sourceId: string;
  filter?: KapaRetrieveFilter;
}): Promise<CascadeRetrieveResult | null> {
  if (!isCascadeRetrieveEnabled()) return null;

  const query = input.query.trim();
  if (!query || !input.sourceId.trim()) return null;

  const minScore = getCascadeVectorMinScore();
  const topK = getCascadeTopK();

  await ensureChunksIndex();
  const store = getVectorStore();
  const queryVector = await embedQuery(query);

  const metadataFilter: Record<string, string> = {
    sourceId: input.sourceId,
  };
  if (input.filter?.url) metadataFilter.url = input.filter.url;
  if (input.filter?.category) metadataFilter.category = input.filter.category;
  if (input.filter?.section) metadataFilter.section = input.filter.section;
  if (input.filter?.crawlRoot) metadataFilter.crawlRoot = input.filter.crawlRoot;

  let initialResults = await store.query({
    indexName: LEDGEINDEX_CHUNKS_INDEX,
    queryVector,
    topK,
    filter: metadataFilter,
  });

  if (
    input.filter?.crawlRoot &&
    initialResults.length === 0 &&
    input.filter.urlPrefix
  ) {
    const { crawlRoot: _drop, ...withoutCrawlRoot } = metadataFilter;
    initialResults = await store.query({
      indexName: LEDGEINDEX_CHUNKS_INDEX,
      queryVector,
      topK,
      filter: withoutCrawlRoot,
    });
  }

  let chunks = initialResults
    .map((result) => toChunk(result, Number(result.score ?? 0)))
    .filter((chunk) => chunk.text.trim().length > 0);

  if (input.filter?.urlPrefix?.trim()) {
    const prefix = input.filter.urlPrefix;
    chunks = chunks.filter((chunk) => urlMatchesPathPrefix(chunk.url, prefix));
  }

  chunks.sort((a, b) => b.score - a.score);
  const scores = chunks.map((c) => c.score);
  const topScore = scores[0] ?? 0;

  if (!shouldAcceptCascadeVectorHit(scores, minScore)) {
    logVerbose("Cascade vector peek — miss, continuing full path", "CascadeRetrieve", {
      sourceId: input.sourceId,
      topScore,
      minScore,
      candidateCount: chunks.length,
    });
    return null;
  }

  const kept = chunks.slice(0, topK);
  const reason = `Cascade vector hit (top ${topScore.toFixed(2)} ≥ ${minScore}) — skipped rewrite + rerank`;

  logVerbose(reason, "CascadeRetrieve", {
    sourceId: input.sourceId,
    topScore,
    kept: kept.length,
  });

  return {
    chunks: kept,
    topScore,
    candidateCount: chunks.length,
    reason,
  };
}
