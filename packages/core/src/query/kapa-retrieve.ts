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
  RELEVANCE_THRESHOLD,
  SEARCH_TOP_K,
  LEDGEINDEX_CHUNKS_INDEX,
  LEXICAL_TOP_K,
} from "../vector/constants.js";
import { embedQuery } from "../vector/embedding.js";
import { ensureChunksIndex, getVectorStore } from "../vector/store.js";
import { fuseDenseAndLexical } from "./hybrid-fuse.js";
import { applyLastMileRank, lastMileRankEnabled } from "./last-mile-rank.js";
import { searchLexical } from "./lexical-store.js";
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
  /** Chunks after page expansion (sibling context). */
  prunedCount: number;
  insufficient: boolean;
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
    attemptType: KapaRetrieveAttemptType;
    filter: KapaRetrieveFilter;
    catalogMatchScore?: number;
    insufficient: boolean;
    initialCount: number;
    rerankedCount: number;
    directHitCount: number;
    directHitScores: number[];
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

/**
 * Group chunks by page (pages ordered by their best score) and sort each
 * page's chunks in reading order so the generator sees coherent context.
 */
function orderChunksForContext(
  chunks: KapaRetrievedChunk[],
): KapaRetrievedChunk[] {
  const pages = new Map<string, KapaRetrievedChunk[]>();
  for (const chunk of chunks) {
    const key = chunk.url || chunkDedupeKey(chunk);
    const list = pages.get(key);
    if (list) list.push(chunk);
    else pages.set(key, [chunk]);
  }

  const rankedPages = [...pages.values()].sort(
    (a, b) =>
      Math.max(...b.map((c) => c.score)) - Math.max(...a.map((c) => c.score)),
  );

  return rankedPages.flatMap((pageChunks) =>
    [...pageChunks].sort((a, b) => a.chunkIndex - b.chunkIndex),
  );
}

/**
 * Kapa-style parent-page expansion: pull sibling chunks for the highest-ranked
 * pages. When hits concentrate on one URL (typical for a single huge docs page),
 * pull a wide page slice and force-include keyword matches so rare entities
 * (e.g. "plan" pin) are not dropped by small top-K vector similarity alone.
 */
async function expandTopPages(input: {
  sourceId: string;
  query: string;
  queryVector: number[];
  pruned: KapaRetrievedChunk[];
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
  // Concentrated expansion pulls a whole page into context, so only use it when
  // that page is the *only* page with hits (single-huge-page corpora). A merely
  // dominant page is often a confusable page that won ranking — letting it
  // concentrate would crowd every other relevant page out of the context.
  const useConcentrated =
    concentratedUrl != null &&
    hitsByUrl.size === 1 &&
    concentrationRatio >= PAGE_EXPANSION_CONCENTRATION_RATIO;

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
        const mapped = results.map((result) =>
          toRetrievedChunk(result, Math.max(0, anchorScore - 0.01)),
        );

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
  return orderChunksForContext(
    dedupeChunks(byQuery.flatMap((entry) => entry.pruned)),
  );
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
 * short_circuit: Q1 first — skip Q2+ if Q1 has direct hits (single-topic).
 * merge_all: run all queries and merge (multi-topic); Q1 then Q2+ in parallel.
 */
export async function kapaRetrieveMany(input: {
  queries: string[];
  sourceId: string;
  /**
   * The user's original question. Used as the rerank query so the cross-encoder
   * scores intent instead of the keyword rewrite, and so scores stay comparable
   * across queries when their results are merged.
   */
  question?: string;
  filter?: KapaRetrieveFilter;
  relevanceThreshold?: number;
  queryMode?: KapaRetrieveQueryMode;
  /** Q1-miss fallback: retry Q1 scoped to this catalog page URL when score is high enough. */
  catalogUrlFilter?: {
    url: string;
    score: number;
    title?: string;
  };
}): Promise<KapaRetrieveManyResult> {
  const wallStarted = performance.now();
  const queries = [
    ...new Set(
      input.queries.map((query) => query.trim()).filter((query) => query.length > 0),
    ),
  ];

  if (queries.length === 0) {
    throw new Error("At least one non-empty query is required");
  }

  const retrieveOpts = {
    sourceId: input.sourceId,
    filter: input.filter,
    relevanceThreshold: input.relevanceThreshold,
    rerankQuery: input.question?.trim() || undefined,
  };

  const toByQueryEntry = (
    result: KapaRetrieveResult,
    extras?: {
      attemptType?: KapaRetrieveAttemptType;
      catalogMatchScore?: number;
    },
  ): KapaRetrieveManyResult["byQuery"][number] => ({
    query: result.query,
    attemptType: extras?.attemptType ?? "query",
    filter: result.filter,
    catalogMatchScore: extras?.catalogMatchScore,
    insufficient: result.insufficient,
    initialCount: result.initialCount,
    rerankedCount: result.rerankedCount,
    directHitCount: result.directHitCount,
    directHitScores: result.directHitScores,
    prunedCount: result.prunedCount,
    rawPrunedCount: result.directHitCount,
    chunks: result.chunks,
    pruned: result.pruned,
  });

  const byQueryRaw: KapaRetrieveManyResult["byQuery"] = [];
  const queryTimings: KapaRetrieveStepTimings[] = [];
  const queryMode = input.queryMode ?? "short_circuit";

  const first = await kapaRetrieve({ query: queries[0], ...retrieveOpts });
  byQueryRaw.push(toByQueryEntry(first));
  if (first.timings) queryTimings.push(first.timings);

  let skippedQueries: string[] = [];
  let catalogUrlFilterResult: KapaRetrieveManyResult["catalogUrlFilter"];
  let catalogSucceeded = false;

  const shouldTryCatalogUrl =
    queryMode === "short_circuit" &&
    first.directHitCount === 0 &&
    Boolean(input.catalogUrlFilter?.url);

  if (shouldTryCatalogUrl && input.catalogUrlFilter) {
    const catalogMatch = input.catalogUrlFilter;
    logVerbose(
      "Kapa retrieve: Q1 missed, trying catalog URL filter",
      "KapaRetrieve",
      {
        query: queries[0],
        url: catalogMatch.url,
        catalogScore: catalogMatch.score,
      },
    );

    const catalogAttempt = await kapaRetrieve({
      query: queries[0],
      ...retrieveOpts,
      filter: {
        ...retrieveOpts.filter,
        url: catalogMatch.url,
      },
    });

    byQueryRaw.push(
      toByQueryEntry(catalogAttempt, {
        attemptType: "catalog_url_fallback",
        catalogMatchScore: catalogMatch.score,
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

    if (catalogSucceeded) {
      skippedQueries = queries.slice(1);
      logVerbose("Kapa retrieve: catalog URL filter succeeded", "KapaRetrieve", {
        query: queries[0],
        url: catalogMatch.url,
        directHitCount: catalogAttempt.directHitCount,
        skipped: skippedQueries,
      });
    }
  }

  const shouldRunRest =
    queries.length > 1 &&
    (queryMode === "merge_all" ||
      (first.directHitCount === 0 && !catalogSucceeded));

  if (queryMode === "short_circuit" && first.directHitCount > 0) {
    skippedQueries = queries.slice(1);
    if (skippedQueries.length > 0) {
      logVerbose("Kapa retrieve: Q1 sufficient, skipping remaining queries", "KapaRetrieve", {
        query: queries[0],
        directHitCount: first.directHitCount,
        skipped: skippedQueries,
      });
    }
  } else if (shouldRunRest) {
    const rest = queries.slice(1);
    logVerbose(
      queryMode === "merge_all"
        ? "Kapa retrieve: multi-topic, running all queries"
        : "Kapa retrieve: Q1 missed, running remaining in parallel",
      "KapaRetrieve",
      { query: queries[0], parallel: rest, queryMode },
    );

    const parallelResults = await Promise.all(
      rest.map((query) => kapaRetrieve({ query, ...retrieveOpts })),
    );
    byQueryRaw.push(...parallelResults.map((r) => toByQueryEntry(r)));
    for (const result of parallelResults) {
      if (result.timings) queryTimings.push(result.timings);
    }
  }

  const byQuery = dedupeAcrossQueries(byQueryRaw);
  const merged = mergePrunedChunks(byQueryRaw);

  const sumPhase = (key: keyof KapaRetrieveStepTimings) =>
    queryTimings.reduce((sum, row) => sum + row[key], 0);

  return {
    queries,
    skippedQueries,
    filter: input.filter ?? {},
    insufficient: merged.length === 0,
    // Every query hits the same source, so they all resolve the same backend.
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

/**
 * Kapa-style retrieval: metadata filter → wide vector search → rerank → pruner threshold.
 * Rerank backend: auto — `vector` on code sources, else the local MiniLM cross-encoder.
 */
export async function kapaRetrieve(input: {
  query: string;
  sourceId: string;
  /**
   * Text scored by the reranker. Defaults to `query`.
   * Pass the user's original question so the cross-encoder judges intent rather
   * than the compressed keyword rewrite, which can match a confusable page.
   */
  rerankQuery?: string;
  filter?: KapaRetrieveFilter;
  relevanceThreshold?: number;
  /**
   * When true (default), expand top pages to fuller page context for answer agents.
   * When false, return score-pruned direct hits only (MCP / evidence tools).
   */
  expandPages?: boolean;
}): Promise<KapaRetrieveResult> {
  const totalStarted = performance.now();
  await ensureChunksIndex();

  const threshold = input.relevanceThreshold ?? RELEVANCE_THRESHOLD;
  const rerankQuery = input.rerankQuery?.trim() || input.query;
  const expandPages = input.expandPages !== false;
  const candidateCount = getSearchRerankCandidates();

  const store = getVectorStore();
  const embedStarted = performance.now();
  const queryVector = await embedQuery(input.query);
  const embedMs = Math.round(performance.now() - embedStarted);

  const metadataFilter: Record<string, string> = {
    sourceId: input.sourceId,
  };
  if (input.filter?.url) metadataFilter.url = input.filter.url;
  if (input.filter?.category) metadataFilter.category = input.filter.category;
  if (input.filter?.section) metadataFilter.section = input.filter.section;
  if (input.filter?.crawlRoot) metadataFilter.crawlRoot = input.filter.crawlRoot;

  const vectorStarted = performance.now();
  // Both legs run against the same source; the lexical one needs no embedding
  // so it costs a single indexed query in parallel with the vector search.
  const [denseInitial, lexicalHits] = await Promise.all([
    store.query({
      indexName: LEDGEINDEX_CHUNKS_INDEX,
      queryVector,
      topK: candidateCount,
      filter: metadataFilter,
    }),
    searchLexical({
      sourceId: input.sourceId,
      query: input.query,
      topK: LEXICAL_TOP_K,
      url: input.filter?.url,
    }),
  ]);

  let denseResults = denseInitial;
  // Older chunks may lack crawlRoot — fall back to source-wide search + URL prefix.
  if (
    input.filter?.crawlRoot &&
    denseResults.length === 0 &&
    input.filter.urlPrefix
  ) {
    const { crawlRoot: _drop, ...withoutCrawlRoot } = metadataFilter;
    denseResults = await store.query({
      indexName: LEDGEINDEX_CHUNKS_INDEX,
      queryVector,
      topK: candidateCount,
      filter: withoutCrawlRoot,
    });
  }

  const fused = fuseDenseAndLexical({
    dense: denseResults,
    lexical: lexicalHits,
    limit: candidateCount,
  });
  const initialResults = fused.results;
  const vectorMs = Math.round(performance.now() - vectorStarted);

  // Whether this source is code decides how it should be ranked, and the
  // candidates are the cheapest place to find out: repo chunks carry a filePath,
  // crawled pages do not.
  const codeCandidateRatio = initialResults.length
    ? initialResults.filter(
        (result) => typeof result.metadata?.filePath === "string",
      ).length / initialResults.length
    : 0;

  logVerbose("Kapa retrieve: hybrid candidate search", "KapaRetrieve", {
    sourceId: input.sourceId,
    initialCount: initialResults.length,
    codeCandidateRatio: Number(codeCandidateRatio.toFixed(2)),
    denseCount: fused.denseCount,
    lexicalCount: fused.lexicalCount,
    lexicalOnlyCount: fused.lexicalOnlyCount,
    candidateCount,
    filter: metadataFilter,
    urlPrefix: input.filter?.urlPrefix ?? null,
  });

  // Resolved here as well as inside the reranker so the answer can report which
  // backend actually scored it; the decision is a pure function of the ratio.
  const { backend: rerankBackendUsed } =
    effectiveRerankBackend(codeCandidateRatio);

  const rerankStarted = performance.now();
  const reranked = await executeKapaRerank({
    query: rerankQuery,
    results: initialResults,
    queryVector,
    topK: SEARCH_TOP_K,
    codeCandidateRatio,
  });
  const rerankMs = Math.round(performance.now() - rerankStarted);

  const pruned = reranked.filter(
    (entry) => entry.score >= threshold,
  );

  // Code corpora need a final metadata-aware pass: see last-mile-rank.ts. It is
  // a no-op on docs-only candidate sets, and runs before the per-page cap so the
  // cap keeps the best chunk of each file rather than the first one retrieved.
  const lastMile = <T extends KapaRetrievedChunk>(list: T[]): T[] =>
    lastMileRankEnabled() ? applyLastMileRank(list, rerankQuery) : list;

  const chunks = lastMile(
    applyUrlPrefixFilter(
      reranked.map((entry) =>
        toRetrievedChunk(entry.result, entry.score, entry.details),
      ),
      input.filter?.urlPrefix,
    ),
  );

  const directHits = capDirectHitsPerPage(
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
  );

  const expandStarted = performance.now();
  const prunedChunks = expandPages
    ? applyUrlPrefixFilter(
        await expandTopPages({
          sourceId: input.sourceId,
          query: input.query,
          queryVector,
          pruned: directHits,
        }),
        input.filter?.urlPrefix,
      )
    : directHits;
  const expandMs = Math.round(performance.now() - expandStarted);

  logVerbose("Kapa retrieve: pruned + page-expanded", "KapaRetrieve", {
    directHits: directHits.length,
    directHitPages: new Set(directHits.map((chunk) => chunk.url)).size,
    withExpansion: prunedChunks.length,
    expandPages,
    rerankedOnQuestion: rerankQuery !== input.query,
  });

  return {
    query: input.query,
    filter: input.filter ?? {},
    rerankBackendUsed,
    initialCount: initialResults.length,
    rerankedCount: reranked.length,
    directHitCount: directHits.length,
    directHitScores: directHits
      .map((chunk) => chunk.score)
      .sort((a, b) => b - a),
    prunedCount: prunedChunks.length,
    insufficient: directHits.length === 0,
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
