import type { MetadataCatalogPage } from "./metadata-catalog.js";
import { pathKeywordsFromUrl } from "../extract/parser/page-title.js";
import { CATALOG_URL_FILTER_THRESHOLD } from "../vector/constants.js";

export type CatalogUrlFilterMatch = {
  url: string;
  score: number;
  title: string;
};

/**
 * Injecting a catalog page's chunks spends part of the fixed reranker candidate
 * budget on one page, so it can evict a candidate the main fusion found. Keep it
 * switchable to measure that trade rather than assuming it.
 */
export function catalogRecoveryEnabled(): boolean {
  const raw = process.env.LEDGEINDEX_CATALOG_RECOVERY?.trim().toLowerCase();
  if (!raw) return true;
  return raw !== "0" && raw !== "false" && raw !== "off";
}

const QUERY_STOPWORDS = new Set([
  "what",
  "whats",
  "which",
  "who",
  "how",
  "why",
  "is",
  "are",
  "was",
  "were",
  "the",
  "and",
  "for",
  "of",
  "in",
  "on",
  "with",
  "from",
  "this",
  "that",
  "you",
  "your",
  "our",
  "can",
  "does",
  "did",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2);
}

function contentTokens(question: string): string[] {
  return tokenize(question).filter((token) => !QUERY_STOPWORDS.has(token));
}

function scorePageForQuestion(
  question: string,
  page: MetadataCatalogPage,
): number {
  const queryTokens = tokenize(question);
  if (queryTokens.length === 0) return 0;

  const haystack = tokenize(
    `${page.title} ${pathKeywordsFromUrl(page.url)}`,
  );
  const haySet = new Set(haystack);

  let hits = 0;
  for (const token of queryTokens) {
    if (haySet.has(token)) hits += 1;
  }

  const overlap = hits / queryTokens.length;
  const titleBonus = page.title.toLowerCase().includes(queryTokens[0] ?? "")
    ? 0.25
    : 0;

  return overlap + titleBonus;
}

/** Most relevant pages first so the planner LLM sees good matches at the top. */
export function rankPagesForQuestion(
  question: string,
  pages: MetadataCatalogPage[],
): MetadataCatalogPage[] {
  const trimmed = question.trim();
  if (!trimmed) return [...pages];

  return [...pages]
    .map((page, index) => ({
      page,
      index,
      score: Math.max(
        scorePageForQuestion(trimmed, page),
        scoreCatalogTitleForQuery(trimmed, page),
      ),
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.page);
}

/**
 * When fusion retrieve returns zero hits, optionally scope retry to the best catalog page
 * if token overlap score meets {@link CATALOG_URL_FILTER_THRESHOLD}.
 */
export function resolveCatalogUrlFilter(
  question: string,
  pages: MetadataCatalogPage[],
): CatalogUrlFilterMatch | null {
  const trimmed = question.trim();
  if (!trimmed || pages.length === 0) return null;

  const top = rankPagesForQuestion(trimmed, pages)[0];
  if (!top) return null;

  const score = scorePageForQuestion(trimmed, top);
  if (score < CATALOG_URL_FILTER_THRESHOLD) return null;

  return {
    url: top.url,
    score,
    title: top.title,
  };
}

function scoreCatalogTitleForQuery(
  question: string,
  page: MetadataCatalogPage,
): number {
  const tokens = contentTokens(question);
  if (tokens.length === 0) return 0;

  const title = page.title.trim();
  const titleTokens = tokenize(`${title} ${pathKeywordsFromUrl(page.url)}`);
  if (titleTokens.length === 0) return 0;
  const titleSet = new Set(titleTokens);

  const querySet = new Set(tokens);

  let contentHits = 0;
  for (const token of tokens) {
    if (titleSet.has(token)) contentHits += 1;
  }
  const contentScore = contentHits / tokens.length;

  let titleHits = 0;
  for (const titleToken of titleTokens) {
    if (querySet.has(titleToken)) titleHits += 1;
  }
  const titleScore = titleHits / titleTokens.length;
  return 0.55 * contentScore + 0.45 * titleScore;
}

/**
 * Catalog page titles to run as extra hybrid queries (not a hard page picker).
 * Hits still go through RRF + rerank on the user question + the relevance threshold.
 */
export function pickCatalogQueryPhrases(
  question: string,
  pages: MetadataCatalogPage[],
  options?: { max?: number; minScore?: number },
): string[] {
  const max = options?.max ?? 1;
  const minScore = options?.minScore ?? 0.42;
  const trimmed = question.trim();
  if (!trimmed || pages.length === 0 || max <= 0) return [];

  const scored = pages.map((page, index) => ({
    title: page.title.trim(),
    score: scoreCatalogTitleForQuery(trimmed, page),
    index,
  }));

  const picked: string[] = [];
  const seen = new Set<string>();
  for (const row of scored.sort(
    (a, b) =>
      b.score - a.score || a.title.length - b.title.length || a.index - b.index,
  )) {
    if (row.score < minScore || !row.title) break;
    const key = row.title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    picked.push(row.title);
    if (picked.length >= max) break;
  }
  return picked;
}

/** Resolve an already-selected catalog title query back to its indexed page. */
export function resolveCatalogQueryUrlFilter(
  question: string,
  catalogQueries: readonly string[],
  pages: MetadataCatalogPage[],
): CatalogUrlFilterMatch | null {
  const titleKeys = new Set(
    catalogQueries.map((query) => query.trim().toLowerCase()).filter(Boolean),
  );
  if (titleKeys.size === 0) return null;

  const page = pages.find((candidate) =>
    titleKeys.has(candidate.title.trim().toLowerCase()),
  );
  if (!page) return null;

  return {
    url: page.url,
    score: scoreCatalogTitleForQuery(question, page),
    title: page.title,
  };
}

/** Append catalog title phrases onto LLM rewrite queries, skipping search duplicates. */
export function mergeRewriteWithCatalogPhrases(input: {
  question: string;
  rewriteQueries: string[];
  pages?: MetadataCatalogPage[] | null;
  topicScope?: "single" | "multi";
}): { queries: string[]; catalogQueries: string[] } {
  const pages = input.pages ?? [];
  const rewriteQueries = input.rewriteQueries.map((query) => query.trim()).filter(Boolean);
  const seeds =
    input.topicScope === "multi" && rewriteQueries.length > 0
      ? rewriteQueries
      : [input.question, ...rewriteQueries];
  const seen = new Set(
    [...rewriteQueries, input.question].map((query) => query.trim().toLowerCase()),
  );
  const catalogQueries: string[] = [];
  const extras: string[] = [];
  if (input.topicScope !== "multi") {
    const best = pages
      .map((page, index) => {
        const originalScore = scoreCatalogTitleForQuery(input.question, page);
        const rewriteScore = Math.max(
          0,
          ...rewriteQueries.map((query) =>
            scoreCatalogTitleForQuery(query, page),
          ),
        );
        return {
          title: page.title.trim(),
          score: 0.45 * originalScore + 0.55 * rewriteScore,
          maxScore: Math.max(originalScore, rewriteScore),
          index,
        };
      })
      .filter((candidate) => candidate.title && candidate.maxScore >= 0.42)
      .sort(
        (left, right) =>
          right.score - left.score ||
          left.title.length - right.title.length ||
          left.index - right.index,
      )[0];
    if (!best) {
      return { queries: rewriteQueries, catalogQueries };
    }
    catalogQueries.push(best.title);
    if (!seen.has(best.title.toLowerCase())) {
      extras.push(best.title);
    }
    return {
      queries: [...rewriteQueries, ...extras],
      catalogQueries,
    };
  }

  for (const seed of seeds) {
    const [phrase] = pickCatalogQueryPhrases(seed, pages, { max: 1 });
    if (!phrase) continue;
    const key = phrase.toLowerCase();
    if (catalogQueries.some((query) => query.toLowerCase() === key)) continue;
    catalogQueries.push(phrase);
    if (!seen.has(key)) {
      seen.add(key);
      extras.push(phrase);
    }
  }
  return {
    queries: [...rewriteQueries, ...extras],
    catalogQueries,
  };
}
