import type { MetadataCatalogPage } from "./metadata-catalog.js";
import { pathKeywordsFromUrl } from "../extract/parser/page-title.js";
import { CATALOG_URL_FILTER_THRESHOLD } from "../vector/constants.js";

export type CatalogUrlFilterMatch = {
  url: string;
  score: number;
  title: string;
};

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2);
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
      score: scorePageForQuestion(trimmed, page),
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
