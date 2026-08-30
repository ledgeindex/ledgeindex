import type { QueryResult } from "@mastra/core/vector";
import type { RerankResult } from "@mastra/rag";
import { logVerbose } from "../lib/logger.js";
import {
  MAX_DIRECT_HITS_PER_PAGE,
  PAGE_EXPANSION_CONCENTRATED_MAX_CHUNKS,
  PAGE_EXPANSION_CONCENTRATED_PULL_CHUNKS,
  PAGE_EXPANSION_CONCENTRATION_RATIO,
  PAGE_EXPANSION_MAX_CHUNKS,
  PAGE_EXPANSION_TOP_URLS,
  PAGE_EXPANSION_WEAK_MAX_CHUNKS,
  PAGE_EXPANSION_WEAK_NEIGHBOUR_RADIUS,
  RELEVANCE_THRESHOLD,
  LEDGEINDEX_CHUNKS_INDEX,
  LEXICAL_TOP_K,
  WEAK_EVIDENCE_MIN_SCORE,
  WEAK_EVIDENCE_TOP_K,
  CATALOG_INJECTION_LIMIT,
} from "../vector/constants.js";
import { embedQuery } from "../vector/embedding.js";
import { ensureChunksIndex, getVectorStore } from "../vector/store.js";
import {
  appendCatalogCandidates,
  fuseDenseAndLexical,
  fuseRankedListsByRrf,
  mergeFusedCandidatePoolsMany,
  ensurePerQueryWinners,
  type FusedQueryResult,
} from "./hybrid-fuse.js";
import { applyLastMileRank, lastMileRankEnabled } from "./last-mile-rank.js";
import {
  pageEvidenceAggregationEnabled,
  rankChunksByPageEvidence,
} from "./page-evidence-rank.js";
import { searchLexical } from "./lexical-store.js";
import { buildRerankQuery, mergeFusionQueries } from "./query-intent.js";
import {
  effectiveRerankBackend,
  executeKapaRerank,
  getSearchRerankCandidates,
  type RerankBackend,
} from "./rerank-backend.js";

export type KapaRetrieveFilter = {
  url?: string;
  category?: string;
  section?: string;
  /** Exact crawl-root start URL stamped at ingest (multi-path sources). */
  crawlRoot?: string;
  /**
   * Keep chunks whose page URL is under this path root.
   * Applied after vector search (covers older chunks without crawlRoot).
   */
  urlPrefix?: string;
};

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

function applyUrlPrefixFilter<T extends { url: string }>(
  chunks: T[],
  urlPrefix: string | undefined,
): T[] {
  if (!urlPrefix?.trim()) return chunks;
  return chunks.filter((chunk) => urlMatchesPathPrefix(chunk.url, urlPrefix));
}

export type KapaRetrieveAttemptType = "query" | "catalog_url_fallback";

/**
 * True when the reranker actually scored this chunk. Page-expansion siblings
 * carry a placeholder score, so score statistics and coverage grading must be
 * computed over direct hits only or they read their own filler back.
 */
export function isDirectHit(chunk: { retrievalKind?: string }): boolean {
  return chunk.retrievalKind !== "expanded";
}

/** True when a page title is the catalog phrase we already chose to search. */
export function pageTitleMatchesCatalog(
  title: string,
  catalogQueries: string[],
): boolean {
  const page = title.trim().toLowerCase();
  if (!page) return false;
  return catalogQueries.some((query) => {
    const phrase = query.trim().toLowerCase();
    if (!phrase) return false;
    return page === phrase || page.includes(phrase) || phrase.includes(page);
  });
}

/**
 * When threshold survivors are a single page and none of them is a catalog
 * title we searched, keep the best catalog-aligned chunk the reranker already
 * scored. Does not replace the winner and does not invent a URL the pool
 * never contained.
 */
export function rescueCatalogAlignedHits(input: {
  directHits: KapaRetrievedChunk[];
  reranked: KapaRetrievedChunk[];
  catalogQueries: string[];
  minScore: number;
}): KapaRetrievedChunk[] {
  const phrases = input.catalogQueries
    .map((query) => query.trim())
    .filter(Boolean);
  if (phrases.length === 0) return input.directHits;

  const alreadyHasCatalogPage = input.directHits.some((chunk) =>
    pageTitleMatchesCatalog(chunk.title, phrases),
  );
  if (alreadyHasCatalogPage) return input.directHits;

  const survivingUrls = new Set(
    input.directHits.map((chunk) => chunk.url.trim()).filter(Boolean),
  );
  if (survivingUrls.size !== 1 && input.directHits.length > 0) {
    return input.directHits;
  }

  const rescue = [...input.reranked]
    .filter((chunk) => {
      if (chunk.score < input.minScore) return false;
      if (!pageTitleMatchesCatalog(chunk.title, phrases)) return false;
      const url = chunk.url.trim();
      return url && !survivingUrls.has(url);
    })
    .sort((left, right) => right.score - left.score)[0];

  if (!rescue) return input.directHits;
  return [...input.directHits, { ...rescue, retrievalKind: "direct" }];
}

export type KapaRetrievedChunk = {
  id: string;
  score: number;
  text: string;
  url: string;
  title: string;
  category: string;
  section: string;
  headingPath: string[];
  chunkIndex: number;
  /**
   * `direct` = scored by the reranker. `expanded` = pulled in as page context,
   * carrying a placeholder score derived from its page's anchor hit.
   * Only `direct` scores are real evidence; see {@link isDirectHit}.
   */
  retrievalKind?: "direct" | "expanded";
  /** Repo sources only: where in the checkout this chunk came from. */
  filePath?: string;
  startLine?: number;
  endLine?: number;
  symbolName?: string;
  symbolKind?: string;
  /** source | test | example | docs | config, stamped at ingest. */
  pageKind?: string;
  details?: RerankResult["details"];
};

export type KapaRetrieveStepTimings = {
  embedMs: number;
  vectorMs: number;
  rerankMs: number;
  expandMs: number;
  totalMs: number;
};

export type KapaRetrieveResult = {
  query: string;
  filter: KapaRetrieveFilter;
  /** The backend that scored this query, which a code source may have overridden. */
  rerankBackendUsed: RerankBackend;
  initialCount: number;
  rerankedCount: number;
  /** Chunks that passed the relevance threshold (before page expansion). */
  directHitCount: number;
  /** Rerank scores of direct hits, highest first. */
  directHitScores: number[];
  /** Top rerank scores before threshold (for UI when direct hits are empty). */
  rerankTopScores: number[];
  /** Chunks after page expansion (sibling context). */
  prunedCount: number;
  insufficient: boolean;
  /** True when below-threshold rerank hits were included as a fallback. */
  weakEvidenceUsed?: boolean;
  /** True when candidates were supplied from multi-query RRF fusion. */
  fusionRetrieveUsed?: boolean;
  /** True when escalation rerank re-scored the pool with a second query phrase. */
  escalatedRerankUsed?: boolean;
  chunks: KapaRetrievedChunk[];
  pruned: KapaRetrievedChunk[];
  timings?: KapaRetrieveStepTimings;
};

function toRetrievedChunk(
  result: QueryResult,
  score: number,
  details?: RerankResult["details"],
): KapaRetrievedChunk {
  const metadata = (result.metadata ?? {}) as Record<string, unknown>;
  const headingPath = Array.isArray(metadata.headingPath)
    ? metadata.headingPath.map(String)
    : [];

  const optionalString = (value: unknown): string | undefined => {
    const text = typeof value === "string" ? value.trim() : "";
    return text || undefined;
  };
  const optionalLine = (value: unknown): number | undefined => {
    const line = Number(value);
    return Number.isFinite(line) && line > 0 ? line : undefined;
  };

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
    retrievalKind: "direct",
    filePath: optionalString(metadata.filePath),
    startLine: optionalLine(metadata.startLine),
    endLine: optionalLine(metadata.endLine),
    symbolName: optionalString(metadata.symbolName),
    symbolKind: optionalString(metadata.symbolKind),
    pageKind: optionalString(metadata.pageKind),
    details,
  };
}

export type KapaRetrieveManyResult = {
  queries: string[];
  /** Planned rewrite queries that were not searched (prior query was sufficient). */
  skippedQueries: string[];
  filter: KapaRetrieveFilter;
  insufficient: boolean;
  /** The backend that scored these queries; a code source may have overridden it. */
  rerankBackendUsed?: RerankBackend;
  catalogUrlFilter?: {
    url: string;
    score: number;
    title: string;
    applied: boolean;
    succeeded: boolean;
  };
  byQuery: Array<{
    query: string;
    /** Exact hybrid-search queries fused into this retrieval attempt. */
    queryVariants?: string[];
    attemptType: KapaRetrieveAttemptType;
    filter: KapaRetrieveFilter;
    catalogMatchScore?: number;
    insufficient: boolean;
    initialCount: number;
    rerankedCount: number;
    directHitCount: number;
    directHitScores: number[];
    rerankTopScores: number[];
    prunedCount: number;
    /** Direct hits before cross-query dedupe. */
    rawPrunedCount: number;
    chunks: KapaRetrievedChunk[];
    pruned: KapaRetrievedChunk[];
  }>;
  /** Deduplicated union of pruned chunks across queries (highest score wins). */
  merged: KapaRetrievedChunk[];
  /** Wall clock for this retrieveMany call; phase sums may exceed wall when parallel. */
  timings?: {
    wallMs: number;
    queryCount: number;
    embedMs: number;
    vectorMs: number;
    rerankMs: number;
    expandMs: number;
  };
};

function chunkDedupeKey(chunk: KapaRetrievedChunk): string {
  if (chunk.id) return chunk.id;
  return `${chunk.url}::${chunk.chunkIndex}::${chunk.text.slice(0, 120)}`;
}

/**
 * Near-duplicate fingerprint. Overlapping chunk splits of the same page often
 * differ only by a leading fragment ("On this page"), so compare tail content.
 */
function chunkTextFingerprint(chunk: KapaRetrievedChunk): string {
  const compact = chunk.text.toLowerCase().replace(/[^a-z0-9]+/g, "");
  return `${chunk.url}::${compact.slice(-240)}`;
}

/** Dedupe exact + near-duplicate chunks, keeping the highest score. */
/**
 * Collapse duplicate chunks, keeping the better-ranked copy of each.
 *
 * Position in the incoming list is the ranking, and the returned order preserves
 * it. Re-sorting on score would be wrong: a score is a relevance value, and
 * relevance is not monotonic in rank once the lexical leg has reordered the pool
 * — a keyword hit can be ranked above a chunk with a higher cosine, which is the
 * entire point of fusing them.
 */
function dedupeChunks(chunks: KapaRetrievedChunk[]): KapaRetrievedChunk[] {
  const byId = new Map<string, KapaRetrievedChunk>();
  for (const chunk of chunks) {
    const key = chunkDedupeKey(chunk);
    if (!byId.has(key)) byId.set(key, chunk);
  }

  const byFingerprint = new Map<string, KapaRetrievedChunk>();
  for (const chunk of byId.values()) {
    const key = chunkTextFingerprint(chunk);
    if (!byFingerprint.has(key)) byFingerprint.set(key, chunk);
  }

  return [...byFingerprint.values()];
}

/**
 * Keep at most {@link MAX_DIRECT_HITS_PER_PAGE} hits per page.
 * Expects rank-ordered input (as returned by {@link dedupeChunks}).
 */
function capDirectHitsPerPage(
  chunks: KapaRetrievedChunk[],
  maxPerPage = MAX_DIRECT_HITS_PER_PAGE,
): KapaRetrievedChunk[] {
  const countByPage = new Map<string, number>();
  const kept: KapaRetrievedChunk[] = [];

  for (const chunk of chunks) {
    const key = chunk.url.trim() || chunkDedupeKey(chunk);
    const count = countByPage.get(key) ?? 0;
    if (count >= maxPerPage) continue;
    countByPage.set(key, count + 1);
    kept.push(chunk);
  }

  return kept;
}

function applyPageEvidenceRanking<T extends KapaRetrievedChunk>(
  chunks: T[],
): T[] {
  return pageEvidenceAggregationEnabled()
    ? rankChunksByPageEvidence(chunks).chunks
    : chunks;
}

/**
 * Group chunks by page evidence and sort each page's chunks in reading order
 * so the generator sees coherent context.
 */
function orderChunksForContext(
  chunks: KapaRetrievedChunk[],
): KapaRetrievedChunk[] {
  const rankedChunks = applyPageEvidenceRanking(chunks);
  const pages = new Map<string, KapaRetrievedChunk[]>();
  for (const chunk of rankedChunks) {
    const key = chunk.url || chunkDedupeKey(chunk);
    const list = pages.get(key);
    if (list) list.push(chunk);
    else pages.set(key, [chunk]);
  }

  return [...pages.values()].flatMap((pageChunks) =>
    [...pageChunks].sort((a, b) => a.chunkIndex - b.chunkIndex),
  );
}

/**
 * Kapa-style parent-page expansion: pull sibling chunks for the highest-ranked
 * pages. When hits concentrate on one URL (typical for a single huge docs page),
 * pull a wide page slice and force-include keyword matches so rare entities
 * (e.g. "plan" pin) are not dropped by small top-K vector similarity alone.
 *
 * Width is gated on `allowConcentrated`, which the caller sets from the anchor's
 * real rerank score. Sole-surviving-page is also the signature of a barely
 * passing relaxed retrieve, so without that gate the widest pull fires exactly
 * when the winner is least trustworthy and a confusable page fills the whole
 * context. Weak anchors get a neighbour window instead of a page slice.
 */
async function expandTopPages(input: {
  sourceId: string;
  query: string;
  queryVector: number[];
  pruned: KapaRetrievedChunk[];
  /** Anchor cleared the strict threshold, so a full page slice is earned. */
  allowConcentrated: boolean;
}): Promise<KapaRetrievedChunk[]> {
  if (input.pruned.length === 0) return input.pruned;

  const topUrls: string[] = [];
  for (const chunk of input.pruned) {
    const url = chunk.url.trim();
    if (!url || topUrls.includes(url)) continue;
    topUrls.push(url);
    if (topUrls.length >= PAGE_EXPANSION_TOP_URLS) break;
  }

  const hitsByUrl = new Map<string, number>();
  for (const chunk of input.pruned) {
    const url = chunk.url.trim();
    if (!url) continue;
    hitsByUrl.set(url, (hitsByUrl.get(url) ?? 0) + 1);
  }

  let concentratedUrl: string | null = null;
  let concentratedHits = 0;
  for (const [url, count] of hitsByUrl) {
    if (count > concentratedHits) {
      concentratedUrl = url;
      concentratedHits = count;
    }
  }
  const concentrationRatio = concentratedHits / input.pruned.length;
  // Concentrated expansion pulls a whole page into context, so require both that
  // the page is the *only* one with hits (single-huge-page corpora) and that its
  // anchor earned it on the strict threshold. A merely dominant page is often a
  // confusable page that won ranking, and letting it concentrate would crowd
  // every other relevant page out of the context.
  const useConcentrated =
    input.allowConcentrated &&
    concentratedUrl != null &&
    hitsByUrl.size === 1 &&
    concentrationRatio >= PAGE_EXPANSION_CONCENTRATION_RATIO;

  // Chunk positions of the real hits on each page, so a weak anchor can be given
  // reading context around itself without pulling the page it may not deserve.
  const hitIndexesByUrl = new Map<string, number[]>();
  for (const chunk of input.pruned) {
    const url = chunk.url.trim();
    if (!url) continue;
    const list = hitIndexesByUrl.get(url);
    if (list) list.push(chunk.chunkIndex);
    else hitIndexesByUrl.set(url, [chunk.chunkIndex]);
  }

  const store = getVectorStore();
  const anchorScoreByUrl = new Map<string, number>();
  for (const chunk of input.pruned) {
    const url = chunk.url.trim();
    if (!anchorScoreByUrl.has(url)) anchorScoreByUrl.set(url, chunk.score);
  }

  const queryTerms = extractExpansionTerms(input.query);

  const siblingsPerUrl = await Promise.all(
    topUrls.map(async (url) => {
      const concentrated = useConcentrated && url === concentratedUrl;
      // Concentrated: pull nearly the whole page, keep vector head + keyword hits.
      const topK = concentrated
        ? PAGE_EXPANSION_CONCENTRATED_PULL_CHUNKS
        : PAGE_EXPANSION_MAX_CHUNKS;

      try {
        const results = await store.query({
          indexName: LEDGEINDEX_CHUNKS_INDEX,
          queryVector: input.queryVector,
          topK,
          filter: { sourceId: input.sourceId, url },
        });

        const anchorScore = anchorScoreByUrl.get(url) ?? 0.5;
        const mapped = results.map((result) => ({
          ...toRetrievedChunk(result, Math.max(0, anchorScore - 0.01)),
          retrievalKind: "expanded" as const,
        }));

        // Weak anchor: keep only chunks adjacent to a real hit, so the generator
        // gets reading context without the page taking over the whole budget.
        if (!input.allowConcentrated) {
          const hitIndexes = hitIndexesByUrl.get(url) ?? [];
          const neighbours = mapped
            .filter((chunk) =>
              hitIndexes.some(
                (hitIndex) =>
                  Math.abs(chunk.chunkIndex - hitIndex) <=
                  PAGE_EXPANSION_WEAK_NEIGHBOUR_RADIUS,
              ),
            )
            .slice(0, PAGE_EXPANSION_WEAK_MAX_CHUNKS);

          logVerbose(
            "Page expansion (weak anchor, neighbours)",
            "KapaRetrieve",
            {
              url,
              anchorScore,
              hitIndexes,
              siblingCount: neighbours.length,
            },
          );
          return neighbours;
        }

        if (!concentrated || queryTerms.length === 0) {
          logVerbose("Page expansion", "KapaRetrieve", {
            url,
            concentrated,
            topK,
            siblingCount: mapped.length,
            queryTerms,
          });
          return mapped;
        }

        // Keep the strongest vector siblings, plus any chunk that mentions a
        // contentful query term (rescues "plan" buried on a 50+ chunk page).
        const vectorHead = mapped.slice(0, PAGE_EXPANSION_MAX_CHUNKS);
        const known = new Set(vectorHead.map((chunk) => chunkDedupeKey(chunk)));
        const rescued: KapaRetrievedChunk[] = [...vectorHead];

        for (const chunk of mapped) {
          const key = chunkDedupeKey(chunk);
          if (known.has(key)) continue;
          if (!chunkMatchesExpansionTerms(chunk, queryTerms)) continue;
          known.add(key);
          rescued.push({
            ...chunk,
            score: Math.max(0, anchorScore - 0.005),
          });
          if (rescued.length >= PAGE_EXPANSION_CONCENTRATED_MAX_CHUNKS) break;
        }

        logVerbose("Page expansion (concentrated + keyword)", "KapaRetrieve", {
          url,
          topK,
          vectorHead: vectorHead.length,
          rescued: rescued.length,
          queryTerms,
          concentrationRatio,
        });

        return rescued;
      } catch (error) {
        logVerbose("Page expansion query failed", "KapaRetrieve", {
          url,
          message: error instanceof Error ? error.message : String(error),
        });
        return [] as KapaRetrievedChunk[];
      }
    }),
  );

  const known = new Set(input.pruned.map((chunk) => chunkDedupeKey(chunk)));
  const expanded = [...input.pruned];

  for (const siblings of siblingsPerUrl) {
    for (const sibling of siblings) {
      const key = chunkDedupeKey(sibling);
      if (known.has(key)) continue;
      known.add(key);
      expanded.push(sibling);
    }
  }

  return orderChunksForContext(dedupeChunks(expanded));
}

const EXPANSION_STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "are",
  "but",
  "not",
  "you",
  "all",
  "can",
  "had",
  "her",
  "was",
  "one",
  "our",
  "out",
  "has",
  "have",
  "been",
  "with",
  "this",
  "that",
  "from",
  "they",
  "what",
  "when",
  "your",
  "which",
  "their",
  "there",
  "would",
  "about",
  "into",
  "than",
  "them",
  "then",
  "these",
  "some",
  "such",
  "only",
  "other",
  "also",
  "how",
  "any",
  "may",
  "type",
  "types",
  "pin",
  "pins",
  "page",
  "docs",
  "documentation",
  "schema",
  "schemas",
]);

/** Contentful query tokens used to rescue missed chunks on large pages. */
function extractExpansionTerms(query: string): string[] {
  const raw = query
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .map((term) => term.trim())
    .filter((term) => term.length >= 3 && !EXPANSION_STOPWORDS.has(term));

  return [...new Set(raw)].sort((a, b) => b.length - a.length).slice(0, 6);
}

function chunkMatchesExpansionTerms(
  chunk: KapaRetrievedChunk,
  terms: string[],
): boolean {
  if (terms.length === 0) return false;
  const haystack = [
    chunk.text,
    chunk.title,
    chunk.section,
    chunk.category,
    ...chunk.headingPath,
  ]
    .join("\n")
    .toLowerCase();

  return terms.some((term) => haystack.includes(term));
}

function mergePrunedChunks(
  byQuery: KapaRetrieveManyResult["byQuery"],
): KapaRetrievedChunk[] {
  const lists = byQuery.map((entry) => entry.pruned);
  const total = lists.reduce((sum, list) => sum + list.length, 0);
  if (total === 0) return [];

  const fused = fuseRankedListsByRrf({
    lists,
    id: chunkDedupeKey,
    limit: total,
    score: (chunk) => chunk.score,
  });

  return orderChunksForContext(dedupeChunks(fused));
}

/** Drop chunks already returned by an earlier query in the same multi-search call. */
function dedupeAcrossQueries(
  byQuery: KapaRetrieveManyResult["byQuery"],
): KapaRetrieveManyResult["byQuery"] {
  const seen = new Set<string>();

  return byQuery.map((entry) => {
    const pruned: KapaRetrievedChunk[] = [];

    for (const chunk of entry.pruned) {
      const key = chunkDedupeKey(chunk);
      if (seen.has(key)) continue;
      seen.add(key);
      pruned.push(chunk);
    }

    return {
      ...entry,
      pruned,
      prunedCount: pruned.length,
      // insufficient = retrieval miss, not "lost" to cross-query dedupe
      insufficient: entry.rawPrunedCount === 0,
    };
  });
}

export type KapaRetrieveQueryMode = "short_circuit" | "merge_all";

/**
 * LlamaIndex-style multi-query retrieve: hybrid each NL variant (same text for
 * vector + BM25), RRF fuse candidates, rerank once on the user question.
 */
export async function kapaRetrieveMany(input: {
  /** Generated NL query variants from rewrite (original question merged at retrieve). */
  queries: string[];
  sourceId: string;
  /** User question, always included in fusion and retained as rerank fallback. */
  question?: string;
  /** Corrected, intent-preserving question for cross-encoder reranking. */
  rerankQuery?: string;
  filter?: KapaRetrieveFilter;
  relevanceThreshold?: number;
  /** Ignored — all fusion queries always run (LlamaIndex merge pattern). */
  queryMode?: KapaRetrieveQueryMode;
  allowWeakEvidence?: boolean;
  weakEvidenceMinScore?: number;
  weakEvidenceTopK?: number;
  expandPages?: boolean;
  catalogUrlFilter?: {
    url: string;
    score: number;
    title?: string;
  };
  /** Catalog page titles that were searched as extra hybrid queries. */
  catalogQueries?: string[];
}): Promise<KapaRetrieveManyResult> {
  const wallStarted = performance.now();
  const generatedQueries = [
    ...new Set(
      input.queries
        .map((query) => query.trim())
        .filter((query) => query.length > 0),
    ),
  ];

  const question = input.question?.trim();
  const fusionQueries = question
    ? mergeFusionQueries(question, generatedQueries)
    : generatedQueries;

  if (fusionQueries.length === 0) {
    throw new Error("At least one non-empty query is required");
  }

  const originalRerankQuery = buildRerankQuery({
    originalQuestion: question || fusionQueries[0],
  });
  const rerankQuery = buildRerankQuery({
    originalQuestion: input.rerankQuery || question || fusionQueries[0],
  });
  const candidateCount = getSearchRerankCandidates();

  const fusionRetrieve = async (filterOverride?: KapaRetrieveFilter) => {
    const filter = filterOverride ?? input.filter;
    const catalogMatch = !filterOverride ? input.catalogUrlFilter : undefined;
    const catalogQuery =
      input.catalogQueries?.find(
        (query) =>
          query.trim().toLowerCase() ===
          catalogMatch?.title?.trim().toLowerCase(),
      ) ??
      catalogMatch?.title?.trim() ??
      fusionQueries[0];
    // The catalog leg is a separate URL-filtered search over the same index, so
    // it shares no state with the main fusion. Awaiting them in sequence added
    // the catalog embed + vector round trip to every request for nothing.
    const [fused, catalogFused] = await Promise.all([
      fuseHybridCandidates({
        fusionQueries,
        sourceId: input.sourceId,
        filter,
        candidateCount,
      }),
      catalogMatch?.url
        ? fuseHybridCandidates({
            fusionQueries: [catalogQuery],
            sourceId: input.sourceId,
            filter: {
              ...filter,
              url: catalogMatch.url,
            },
            candidateCount,
          })
        : null,
    ]);
    const fusionResults = ensurePerQueryWinners(
      [fused.results],
      mergeFusedCandidatePoolsMany([fused.results], candidateCount),
      candidateCount,
    );
    const initialResults = catalogFused
      ? appendCatalogCandidates(
          fusionResults,
          catalogFused.results,
          CATALOG_INJECTION_LIMIT,
        )
      : fusionResults;
    return kapaRetrieve({
      query: fusionQueries[0],
      rerankQuery,
      escalationRerankQuery: originalRerankQuery,
      prefused: {
        initialResults,
        queryVector: fused.queryVector,
        fusionMeta: catalogFused
          ? {
              denseCount:
                fused.fused.denseCount + catalogFused.fused.denseCount,
              lexicalCount:
                fused.fused.lexicalCount + catalogFused.fused.lexicalCount,
              lexicalOnlyCount:
                fused.fused.lexicalOnlyCount +
                catalogFused.fused.lexicalOnlyCount,
            }
          : fused.fused,
        embedMs: fused.embedMs + (catalogFused?.embedMs ?? 0),
        vectorMs: fused.vectorMs + (catalogFused?.vectorMs ?? 0),
      },
      sourceId: input.sourceId,
      filter,
      relevanceThreshold: input.relevanceThreshold,
      allowWeakEvidence: input.allowWeakEvidence,
      weakEvidenceMinScore: input.weakEvidenceMinScore,
      weakEvidenceTopK: input.weakEvidenceTopK,
      expandPages: input.expandPages,
      catalogQueries: input.catalogQueries,
    });
  };

  const toByQueryEntry = (
    result: KapaRetrieveResult,
    extras?: {
      attemptType?: KapaRetrieveAttemptType;
      catalogMatchScore?: number;
      fusionLabel?: string;
      queryVariants?: string[];
    },
  ): KapaRetrieveManyResult["byQuery"][number] => ({
    query: extras?.fusionLabel ?? result.query,
    queryVariants: extras?.queryVariants,
    attemptType: extras?.attemptType ?? "query",
    filter: result.filter,
    catalogMatchScore: extras?.catalogMatchScore,
    insufficient: result.insufficient,
    initialCount: result.initialCount,
    rerankedCount: result.rerankedCount,
    directHitCount: result.directHitCount,
    directHitScores: result.directHitScores,
    rerankTopScores: result.rerankTopScores,
    prunedCount: result.prunedCount,
    rawPrunedCount: result.directHitCount,
    chunks: result.chunks,
    pruned: result.pruned,
  });

  const fusionLabel =
    fusionQueries.length === 1
      ? fusionQueries[0]
      : `${fusionQueries[0]} (+${fusionQueries.length - 1} variants)`;

  const byQueryRaw: KapaRetrieveManyResult["byQuery"] = [];
  const queryTimings: KapaRetrieveStepTimings[] = [];

  const first = await fusionRetrieve();
  byQueryRaw.push(
    toByQueryEntry(first, { fusionLabel, queryVariants: fusionQueries }),
  );
  if (first.timings) queryTimings.push(first.timings);

  let skippedQueries: string[] = [];
  let catalogUrlFilterResult: KapaRetrieveManyResult["catalogUrlFilter"];
  let catalogSucceeded = false;

  const shouldTryCatalogUrl =
    first.directHitCount === 0 && Boolean(input.catalogUrlFilter?.url);

  if (shouldTryCatalogUrl && input.catalogUrlFilter) {
    const catalogMatch = input.catalogUrlFilter;
    logVerbose(
      "Kapa retrieve: fusion missed, trying catalog URL filter",
      "KapaRetrieve",
      {
        fusionQueries,
        url: catalogMatch.url,
        catalogScore: catalogMatch.score,
      },
    );

    const catalogAttempt = await fusionRetrieve({
      ...input.filter,
      url: catalogMatch.url,
    });

    byQueryRaw.push(
      toByQueryEntry(catalogAttempt, {
        attemptType: "catalog_url_fallback",
        catalogMatchScore: catalogMatch.score,
        fusionLabel: `${fusionLabel} @ ${catalogMatch.url}`,
      }),
    );
    if (catalogAttempt.timings) queryTimings.push(catalogAttempt.timings);

    catalogSucceeded = catalogAttempt.directHitCount > 0;
    catalogUrlFilterResult = {
      url: catalogMatch.url,
      score: catalogMatch.score,
      title: catalogMatch.title?.trim() || catalogMatch.url,
      applied: true,
      succeeded: catalogSucceeded,
    };
  }

  const byQuery = dedupeAcrossQueries(byQueryRaw);
  const merged = mergePrunedChunks(byQueryRaw);

  const sumPhase = (key: keyof KapaRetrieveStepTimings) =>
    queryTimings.reduce((sum, row) => sum + row[key], 0);

  return {
    queries: fusionQueries,
    skippedQueries,
    filter: input.filter ?? {},
    insufficient: merged.length === 0,
    rerankBackendUsed: first.rerankBackendUsed,
    catalogUrlFilter: catalogUrlFilterResult,
    byQuery,
    merged,
    timings: {
      wallMs: Math.round(performance.now() - wallStarted),
      queryCount: queryTimings.length,
      embedMs: sumPhase("embedMs"),
      vectorMs: sumPhase("vectorMs"),
      rerankMs: sumPhase("rerankMs"),
      expandMs: sumPhase("expandMs"),
    },
  };
}

type HybridSearchOutcome = {
  results: FusedQueryResult[];
  fused: {
    denseCount: number;
    lexicalCount: number;
    lexicalOnlyCount: number;
  };
  embedMs: number;
  vectorMs: number;
  queryVector: number[];
};

async function hybridCandidateSearch(input: {
  sourceId: string;
  embedText: string;
  lexicalText: string;
  filter?: KapaRetrieveFilter;
  candidateCount: number;
}): Promise<HybridSearchOutcome> {
  const store = getVectorStore();
  const embedStarted = performance.now();
  const queryVector = await embedQuery(input.embedText);
  const embedMs = Math.round(performance.now() - embedStarted);

  const metadataFilter: Record<string, string> = {
    sourceId: input.sourceId,
  };
  if (input.filter?.url) metadataFilter.url = input.filter.url;
  if (input.filter?.category) metadataFilter.category = input.filter.category;
  if (input.filter?.section) metadataFilter.section = input.filter.section;
  if (input.filter?.crawlRoot)
    metadataFilter.crawlRoot = input.filter.crawlRoot;

  const vectorStarted = performance.now();
  const [denseInitial, lexicalHits] = await Promise.all([
    store.query({
      indexName: LEDGEINDEX_CHUNKS_INDEX,
      queryVector,
      topK: input.candidateCount,
      filter: metadataFilter,
    }),
    searchLexical({
      sourceId: input.sourceId,
      query: input.lexicalText,
      topK: LEXICAL_TOP_K,
      url: input.filter?.url,
    }),
  ]);

  let denseResults = denseInitial;
  if (
    input.filter?.crawlRoot &&
    denseResults.length === 0 &&
    input.filter.urlPrefix
  ) {
    const { crawlRoot: _drop, ...withoutCrawlRoot } = metadataFilter;
    denseResults = await store.query({
      indexName: LEDGEINDEX_CHUNKS_INDEX,
      queryVector,
      topK: input.candidateCount,
      filter: withoutCrawlRoot,
    });
  }

  const fused = fuseDenseAndLexical({
    dense: denseResults,
    lexical: lexicalHits,
    limit: input.candidateCount,
  });
  const vectorMs = Math.round(performance.now() - vectorStarted);

  return {
    results: fused.results,
    fused: {
      denseCount: fused.denseCount,
      lexicalCount: fused.lexicalCount,
      lexicalOnlyCount: fused.lexicalOnlyCount,
    },
    embedMs,
    vectorMs,
    queryVector,
  };
}

async function fuseHybridCandidates(input: {
  fusionQueries: string[];
  sourceId: string;
  filter?: KapaRetrieveFilter;
  candidateCount: number;
}): Promise<HybridSearchOutcome> {
  const hybrids = await Promise.all(
    input.fusionQueries.map((query) =>
      hybridCandidateSearch({
        sourceId: input.sourceId,
        embedText: query,
        lexicalText: query,
        filter: input.filter,
        candidateCount: input.candidateCount,
      }),
    ),
  );

  const merged = mergeFusedCandidatePoolsMany(
    hybrids.map((hybrid) => hybrid.results),
    input.candidateCount,
  );
  const results = ensurePerQueryWinners(
    hybrids.map((hybrid) => hybrid.results),
    merged,
    input.candidateCount,
  );

  return {
    results,
    fused: {
      denseCount: hybrids.reduce(
        (sum, hybrid) => sum + hybrid.fused.denseCount,
        0,
      ),
      lexicalCount: hybrids.reduce(
        (sum, hybrid) => sum + hybrid.fused.lexicalCount,
        0,
      ),
      lexicalOnlyCount: hybrids.reduce(
        (sum, hybrid) => sum + hybrid.fused.lexicalOnlyCount,
        0,
      ),
    },
    embedMs: hybrids.reduce((sum, hybrid) => sum + hybrid.embedMs, 0),
    vectorMs: hybrids.reduce((sum, hybrid) => sum + hybrid.vectorMs, 0),
    queryVector: hybrids[0]?.queryVector ?? [],
  };
}

/**
 * Kapa-style retrieval: metadata filter → wide vector search → rerank → pruner threshold.
 * Rerank backend: auto — `vector` on code sources, else the local MiniLM cross-encoder.
 */
export async function kapaRetrieve(input: {
  query: string;
  sourceId: string;
  /**
   * Natural-language sentence for cross-encoder reranking. Defaults to `query`.
   */
  rerankQuery?: string;
  /**
   * When primary rerank yields zero hits, re-score the same pool with this phrase.
   */
  escalationRerankQuery?: string;
  /** Pre-fused hybrid candidates (multi-query RRF path). */
  prefused?: {
    initialResults: FusedQueryResult[];
    queryVector: number[];
    fusionMeta: {
      denseCount: number;
      lexicalCount: number;
      lexicalOnlyCount: number;
    };
    embedMs: number;
    vectorMs: number;
  };
  filter?: KapaRetrieveFilter;
  relevanceThreshold?: number;
  /**
   * When true (default), expand top pages to fuller page context for answer agents.
   * When false, return score-pruned direct hits only (MCP / evidence tools).
   */
  expandPages?: boolean;
  /** Include top reranked chunks when nothing passes `relevanceThreshold`. */
  allowWeakEvidence?: boolean;
  weakEvidenceMinScore?: number;
  weakEvidenceTopK?: number;
  /** Catalog page titles that were searched as extra hybrid queries. */
  catalogQueries?: string[];
}): Promise<KapaRetrieveResult> {
  const totalStarted = performance.now();
  await ensureChunksIndex();

  const threshold = input.relevanceThreshold ?? RELEVANCE_THRESHOLD;
  const intentRerank = input.rerankQuery?.trim() || input.query;
  const expandPages = input.expandPages !== false;
  const candidateCount = getSearchRerankCandidates();
  const prefused = input.prefused;
  const fusionRetrieveUsed = Boolean(prefused);

  let embedMs = 0;
  let vectorMs = 0;
  let queryVector: number[];
  let initialResults: FusedQueryResult[];
  let fusionMeta = {
    denseCount: 0,
    lexicalCount: 0,
    lexicalOnlyCount: 0,
  };

  if (prefused) {
    embedMs = prefused.embedMs;
    vectorMs = prefused.vectorMs;
    queryVector = prefused.queryVector;
    initialResults = prefused.initialResults;
    fusionMeta = prefused.fusionMeta;
  } else {
    const single = await hybridCandidateSearch({
      sourceId: input.sourceId,
      embedText: input.query,
      lexicalText: input.query,
      filter: input.filter,
      candidateCount,
    });
    embedMs = single.embedMs;
    vectorMs = single.vectorMs;
    queryVector = single.queryVector;
    initialResults = single.results;
    fusionMeta = single.fused;
  }

  const codeCandidateRatio = initialResults.length
    ? initialResults.filter(
        (result) => typeof result.metadata?.filePath === "string",
      ).length / initialResults.length
    : 0;

  logVerbose("Kapa retrieve: hybrid candidate search", "KapaRetrieve", {
    sourceId: input.sourceId,
    initialCount: initialResults.length,
    fusionRetrieveUsed,
    codeCandidateRatio: Number(codeCandidateRatio.toFixed(2)),
    denseCount: fusionMeta.denseCount,
    lexicalCount: fusionMeta.lexicalCount,
    lexicalOnlyCount: fusionMeta.lexicalOnlyCount,
    candidateCount,
    filter: input.filter ?? {},
    urlPrefix: input.filter?.urlPrefix ?? null,
  });

  const { backend: rerankBackendUsed } =
    effectiveRerankBackend(codeCandidateRatio);

  const rerankStarted = performance.now();
  let reranked = await executeKapaRerank({
    query: intentRerank,
    results: initialResults,
    queryVector,
    topK: initialResults.length,
    codeCandidateRatio,
  });

  let escalatedRerankUsed = false;
  let pruned = reranked.filter((entry) => entry.score >= threshold);

  const lastMile = <T extends KapaRetrievedChunk>(list: T[]): T[] =>
    lastMileRankEnabled() ? applyLastMileRank(list, intentRerank) : list;

  let directHits = capDirectHitsPerPage(
    applyPageEvidenceRanking(
      lastMile(
        applyUrlPrefixFilter(
          dedupeChunks(
            pruned.map((entry) =>
              toRetrievedChunk(entry.result, entry.score, entry.details),
            ),
          ),
          input.filter?.urlPrefix,
        ),
      ),
    ),
  );

  if (
    pruned.length > 0 &&
    directHits.length === 0 &&
    input.filter?.urlPrefix?.trim()
  ) {
    logVerbose(
      "Kapa retrieve: urlPrefix removed all threshold hits",
      "KapaRetrieve",
      {
        sourceId: input.sourceId,
        urlPrefix: input.filter.urlPrefix,
        prunedCount: pruned.length,
        topScore: pruned[0]?.score,
        threshold,
      },
    );
  }

  const escalation = input.escalationRerankQuery?.trim();
  if (
    directHits.length === 0 &&
    escalation &&
    escalation !== intentRerank &&
    initialResults.length > 0
  ) {
    reranked = await executeKapaRerank({
      query: escalation,
      results: initialResults,
      queryVector,
      topK: initialResults.length,
      codeCandidateRatio,
    });
    escalatedRerankUsed = true;
    pruned = reranked.filter((entry) => entry.score >= threshold);
    directHits = capDirectHitsPerPage(
      applyPageEvidenceRanking(
        lastMile(
          applyUrlPrefixFilter(
            dedupeChunks(
              pruned.map((entry) =>
                toRetrievedChunk(entry.result, entry.score, entry.details),
              ),
            ),
            input.filter?.urlPrefix,
          ),
        ),
      ),
    );
    logVerbose("Kapa retrieve: escalation rerank", "KapaRetrieve", {
      sourceId: input.sourceId,
      escalation,
      directHits: directHits.length,
      topScore: directHits[0]?.score,
    });
  }

  const rerankMs = Math.round(performance.now() - rerankStarted);

  const chunks = applyPageEvidenceRanking(
    lastMile(
      applyUrlPrefixFilter(
        reranked.map((entry) =>
          toRetrievedChunk(entry.result, entry.score, entry.details),
        ),
        input.filter?.urlPrefix,
      ),
    ),
  );

  let weakEvidenceUsed = false;
  let effectiveDirectHits = directHits;

  if (
    input.allowWeakEvidence &&
    directHits.length === 0 &&
    reranked.length > 0
  ) {
    const weakMin = input.weakEvidenceMinScore ?? WEAK_EVIDENCE_MIN_SCORE;
    const weakTopK = input.weakEvidenceTopK ?? WEAK_EVIDENCE_TOP_K;
    const weakEntries = reranked
      .filter((entry) => entry.score >= weakMin)
      .slice(0, weakTopK);

    if (weakEntries.length > 0) {
      effectiveDirectHits = capDirectHitsPerPage(
        applyPageEvidenceRanking(
          lastMile(
            applyUrlPrefixFilter(
              weakEntries.map((entry) =>
                toRetrievedChunk(entry.result, entry.score, entry.details),
              ),
              input.filter?.urlPrefix,
            ),
          ),
        ),
      );
      weakEvidenceUsed = effectiveDirectHits.length > 0;
      logVerbose("Kapa retrieve: weak-evidence fallback", "KapaRetrieve", {
        sourceId: input.sourceId,
        weakMin,
        weakTopK,
        count: effectiveDirectHits.length,
        topScore: effectiveDirectHits[0]?.score,
      });
    }
  }

  const beforeRescuePages = new Set(
    effectiveDirectHits.map((chunk) => chunk.url),
  ).size;
  effectiveDirectHits = rescueCatalogAlignedHits({
    directHits: effectiveDirectHits,
    reranked: chunks,
    catalogQueries: input.catalogQueries ?? [],
    minScore: Math.max(0.35, threshold - 0.15),
  });
  if (
    new Set(effectiveDirectHits.map((chunk) => chunk.url)).size >
    beforeRescuePages
  ) {
    logVerbose("Kapa retrieve: catalog-aligned page rescued", "KapaRetrieve", {
      sourceId: input.sourceId,
      catalogQueries: input.catalogQueries,
      pages: [...new Set(effectiveDirectHits.map((chunk) => chunk.title))],
    });
  }

  const pageEvidence = pageEvidenceAggregationEnabled()
    ? rankChunksByPageEvidence(effectiveDirectHits)
    : null;
  if (pageEvidence) {
    effectiveDirectHits = pageEvidence.chunks;
    logVerbose("Kapa retrieve: page evidence aggregation", "KapaRetrieve", {
      sourceId: input.sourceId,
      pageCount: pageEvidence.pages.length,
      anchorUrl: pageEvidence.anchor?.url ?? null,
      anchorScore: pageEvidence.anchor?.score ?? null,
      runnerUpScore: pageEvidence.pages[1]?.score ?? null,
      margin:
        pageEvidence.pages.length > 1
          ? (pageEvidence.pages[0]?.score ?? 0) -
            (pageEvidence.pages[1]?.score ?? 0)
          : null,
    });
  }

  const expandStarted = performance.now();
  // Expansion width follows the anchor's real score, not how few pages survived.
  const anchorTopScore = effectiveDirectHits.reduce(
    (max, chunk) => Math.max(max, chunk.score),
    0,
  );
  const strictAnchor =
    !weakEvidenceUsed && anchorTopScore >= RELEVANCE_THRESHOLD;
  const prunedChunks = expandPages
    ? applyUrlPrefixFilter(
        await expandTopPages({
          sourceId: input.sourceId,
          query: input.query,
          queryVector,
          pruned: effectiveDirectHits,
          allowConcentrated: strictAnchor,
        }),
        input.filter?.urlPrefix,
      )
    : effectiveDirectHits;
  const expandMs = Math.round(performance.now() - expandStarted);

  const rerankTopScores = reranked
    .map((entry) => entry.score)
    .sort((a, b) => b - a)
    .slice(0, 8);

  logVerbose("Kapa retrieve: pruned + page-expanded", "KapaRetrieve", {
    directHits: effectiveDirectHits.length,
    directHitPages: new Set(effectiveDirectHits.map((chunk) => chunk.url)).size,
    withExpansion: prunedChunks.length,
    expandedCount: prunedChunks.filter((chunk) => !isDirectHit(chunk)).length,
    anchorTopScore,
    strictAnchor,
    expandPages,
    weakEvidenceUsed,
    fusionRetrieveUsed,
    escalatedRerankUsed,
    rerankedOnIntent: intentRerank !== input.query,
  });

  return {
    query: input.query,
    filter: input.filter ?? {},
    rerankBackendUsed,
    initialCount: initialResults.length,
    rerankedCount: reranked.length,
    directHitCount: effectiveDirectHits.length,
    directHitScores: effectiveDirectHits
      .map((chunk) => chunk.score)
      .sort((a, b) => b - a),
    rerankTopScores,
    prunedCount: prunedChunks.length,
    insufficient: effectiveDirectHits.length === 0,
    weakEvidenceUsed,
    fusionRetrieveUsed,
    escalatedRerankUsed,
    chunks,
    pruned: prunedChunks,
    timings: {
      embedMs,
      vectorMs,
      rerankMs,
      expandMs,
      totalMs: Math.round(performance.now() - totalStarted),
    },
  };
}
