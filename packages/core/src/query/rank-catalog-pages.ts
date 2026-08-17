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

/** Path keywords from URL (e.g. agents a2a), not a single slug segment. */
function keywordsFromPageUrl(url: string): string | undefined {
  const keywords = pathKeywordsFromUrl(url);
  return keywords.length >= 2 ? keywords : undefined;
}

export function bestPageQueryFallback(
  question: string,
  pages: MetadataCatalogPage[],
): string | undefined {
  const ranked = rankPagesForQuestion(question, pages);
  const top = ranked[0];
  if (!top) return undefined;

  const score = scorePageForQuestion(question, top);
  if (score < 0.2) return undefined;

  const fromKeywords = keywordsFromPageUrl(top.url);
  if (fromKeywords) return fromKeywords;

  const titleWords = top.title
    .split(/[|–—\-:]+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 2);

  const focused =
    titleWords.find((part) =>
      question.toLowerCase().includes(part.toLowerCase()),
    ) ?? titleWords[0];

  return focused?.trim().toLowerCase() || undefined;
}

/**
 * When Q1 vector search misses, optionally scope retry to the best catalog page
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

/** Prefer the URL prefix with the longer pathname (more specific scope). */
export function pickNarrowerUrlPrefix(
  a?: string,
  b?: string,
): string | undefined {
  const left = a?.trim();
  const right = b?.trim();
  if (!left) return right || undefined;
  if (!right) return left;

  try {
    const pathA = new URL(left).pathname.replace(/\/+$/, "") || "/";
    const pathB = new URL(right).pathname.replace(/\/+$/, "") || "/";
    return pathB.length >= pathA.length ? right : left;
  } catch {
    return right.length >= left.length ? right : left;
  }
}

const DOMAIN_HINT_ALIASES: Record<string, string[]> = {
  api: ["api", "reference"],
  reference: ["reference", "api"],
  guides: ["guides", "guide", "docs"],
  docs: ["docs", "documentation", "guide"],
};

function normalizeHintToken(hint: string): string {
  return hint.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function hintMatchesPathSegment(segment: string, hint: string): boolean {
  const normalizedSegment = segment.toLowerCase();
  const normalizedHint = normalizeHintToken(hint);
  if (!normalizedHint) return false;
  if (normalizedSegment === normalizedHint) return true;
  const aliases = DOMAIN_HINT_ALIASES[normalizedHint] ?? [normalizedHint];
  return aliases.some(
    (alias) =>
      normalizedSegment === alias || normalizedSegment.includes(alias),
  );
}

/**
 * Map rewrite `domainHints` (reference, guides, API) to a catalog URL prefix.
 * Requires several indexed pages under that path segment to avoid noise.
 */
export function resolveDomainHintsUrlPrefix(
  hints: string[],
  pages: MetadataCatalogPage[],
  options?: { minPages?: number },
): string | undefined {
  const minPages = options?.minPages ?? 3;
  const normalizedHints = [...new Set(hints.map((h) => h.trim()).filter(Boolean))];
  if (normalizedHints.length === 0 || pages.length === 0) return undefined;

  for (const hint of normalizedHints) {
    const matching = pages.filter((page) => {
      try {
        const segments = new URL(page.url).pathname
          .split("/")
          .filter(Boolean);
        return segments.some((segment) => hintMatchesPathSegment(segment, hint));
      } catch {
        return false;
      }
    });

    if (matching.length < minPages) continue;

    const sample = new URL(matching[0].url);
    const segments = sample.pathname.split("/").filter(Boolean);
    const segmentIndex = segments.findIndex((segment) =>
      hintMatchesPathSegment(segment, hint),
    );
    if (segmentIndex < 0) continue;

    const prefixPath = `/${segments.slice(0, segmentIndex + 1).join("/")}`;
    return `${sample.origin}${prefixPath}`;
  }

  return undefined;
}
