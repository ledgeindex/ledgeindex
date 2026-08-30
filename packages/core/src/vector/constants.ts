/** PgVector / LibSQL index name for crawled doc chunks. */
export const LEDGEINDEX_CHUNKS_INDEX = "ledgeindex_chunks";

/** fastembed bge-small-en-v1.5 (local). */
export const LOCAL_EMBEDDING_DIMENSION = 384;

/** Google gemini-embedding-2 @ 1536 dims (production, max quality). */
export const PROD_EMBEDDING_DIMENSION = 1536;

/** Wide vector pull before re-rank when Cohere/cloud rerank is cheap. */
export const SEARCH_RERANK_CANDIDATES = 50;

/**
 * Smaller pull for local CPU cross-encoders (MiniLM/BGE).
 * 50 candidates on CPU is a major latency bottleneck.
 */
export const SEARCH_RERANK_CANDIDATES_LOCAL = 20;

/** Final chunks after re-rank. */
export const SEARCH_TOP_K = 8;

export const SEARCH_RERANK_WEIGHTS = {
  semantic: 0.5,
  vector: 0.3,
  position: 0.2,
} as const;

/** Pruner threshold — chunks below this never reach the generator. */
export const RELEVANCE_THRESHOLD = 0.65;

/** Second-pass threshold when the strict pass finds nothing. */
export const RELAXED_RELEVANCE_THRESHOLD = 0.5;

/** Kapa-style page context: expand sibling chunks for the N best pages. */
export const PAGE_EXPANSION_TOP_URLS = 2;

/**
 * Max direct hits kept per page before page expansion.
 * Without this, a page with many near-identical chunks wins the whole ranking
 * and crowds out other relevant pages. Page context is restored afterwards by
 * expansion, so the cap decides which pages compete, not how much of a page
 * the generator ends up seeing.
 */
export const MAX_DIRECT_HITS_PER_PAGE = 3;

/**
 * Default max chunks pulled per expanded page (vector-similar siblings).
 * Not the full page — rare terms on huge pages can still miss.
 */
export const PAGE_EXPANSION_MAX_CHUNKS = 10;

/**
 * Wide pull when scanning a concentrated page for keyword rescue.
 * Kept context is still capped by PAGE_EXPANSION_CONCENTRATED_MAX_CHUNKS.
 */
export const PAGE_EXPANSION_CONCENTRATED_PULL_CHUNKS = 200;

/**
 * Max chunks kept after concentrated expansion (vector head + keyword rescues).
 */
export const PAGE_EXPANSION_CONCENTRATED_MAX_CHUNKS = 48;

/** Min share of direct hits on one URL to trigger concentrated expansion. */
export const PAGE_EXPANSION_CONCENTRATION_RATIO = 0.5;

/**
 * Chunk distance from a real hit that still counts as reading context, used when
 * the anchor did not clear the strict threshold. A page that only won on the
 * relaxed pass earns context around its hit, not a slice of the whole page.
 */
export const PAGE_EXPANSION_WEAK_NEIGHBOUR_RADIUS = 1;

/** Max sibling chunks kept per page when the anchor is a relaxed-pass hit. */
export const PAGE_EXPANSION_WEAK_MAX_CHUNKS = 3;

/** Min catalog page score to scope Q2 vector search to a single URL. */
export const CATALOG_URL_FILTER_THRESHOLD = 0.7;

/**
 * Catalog chunks appended to the reranker pool on top of the fusion candidates.
 *
 * Fusing the catalog page in as a second RRF pool made it compete for the fixed
 * candidate budget, which cost roughly one page of evidence per query without
 * improving recall. Appending keeps the recovery while leaving what fusion found
 * intact; the cross-encoder still decides whether the page survives.
 */
export const CATALOG_INJECTION_LIMIT = 4;

/** Companion keyword table alongside LEDGEINDEX_CHUNKS_INDEX. */
export const LEXICAL_TABLE = "ledgeindex_chunk_lexical";

/** Candidates pulled from the lexical leg before fusion. */
export const LEXICAL_TOP_K = 20;

/**
 * BM25 weight on the heading field (file path, symbol path, page title) versus
 * 1.0 on the body. A term in the path is a much stronger signal than the same
 * term somewhere inside a function.
 */
export const LEXICAL_HEADING_WEIGHT = 5;

/**
 * Reciprocal rank fusion constant. 60 is the value from the original RRF paper
 * and is what most hybrid search implementations use; it damps the difference
 * between rank 1 and rank 2 enough that neither leg can dominate on its own.
 */
export const RRF_K = 60;

/** Min rerank score for weak-evidence fallback chunks. */
export const WEAK_EVIDENCE_MIN_SCORE = 0.15;

/** Max chunks kept on weak-evidence fallback. */
export const WEAK_EVIDENCE_TOP_K = 5;

/** Tier 1 coverage full: min max injected chunk score (strict pass). */
export const COVERAGE_FULL_MAX_SCORE = 0.82;

/** Tier 1 coverage full: min avg of top 3 injected chunk scores. */
export const COVERAGE_FULL_AVG_TOP3 = 0.75;

/**
 * Cascade retrieve: tiny vector peek before rewrite + rerank.
 * Raw embedding similarity must clear this to early-exit.
 * Tuned on local BGE/fastembed (Mastra corpus tops ~0.83; junk ~0.77).
 */
export const CASCADE_VECTOR_MIN_SCORE = 0.8;

/** How many chunks to keep on a cascade hit (no rerank). */
export const CASCADE_RETRIEVE_TOP_K = 3;
