import { lexicalQueryTerms, splitIdentifier } from "./code-tokens.js";

/**
 * Last-mile reordering for code sources.
 *
 * Fusion and the cross-encoder decide which chunks are candidates, and both are
 * good at that. What neither does well is the final few positions on a code
 * corpus, where three failure modes dominate:
 *
 * 1. A repository that ships versioned docs (`docs/v2`, `docs/v3`, `docs/v4`)
 *    returns the same page three times, spending three of eight slots on one
 *    concept.
 * 2. A file whose *name* is the answer — `browserClipboard.ts`, `timeouts.ts` —
 *    loses to a prose page, because the prose page appears in both retrieval
 *    legs and so collects double reciprocal-rank credit while the
 *    implementation file appears in one.
 * 3. Several chunks of one long file crowd out every other file.
 *
 * All three are cheap to detect from metadata already on the chunk, so this
 * stage is a feature reorder rather than another model: no network call, no
 * inference, sub-millisecond.
 *
 * Scores are *permuted*, not recomputed: the reordered list carries the same
 * multiset of scores it arrived with, so any downstream relevance threshold sees
 * an unchanged distribution and only the ordering improves.
 */

/** Weight on the metadata features; the incoming rank takes the remainder. */
const FEATURE_WEIGHT = 0.4;

/**
 * How fast the incoming rank loses authority with depth, as the denominator of
 * `1 / (1 + index / softness)`. A reciprocal rather than a linear ramp for two
 * reasons: the gap per position does not depend on how many candidates came
 * back, and it narrows with depth, so features decide the tail — where the
 * incoming order is least trustworthy — without overriding a confident lead.
 */
const RANK_SOFTNESS = 4;

/** Within the feature score. Path is the strongest of the three. */
const PATH_WEIGHT = 0.55;
const SYMBOL_WEIGHT = 0.3;
const KIND_WEIGHT = 0.15;

/** A path segment that is not the filename still matters, just less. */
const DIRECTORY_TOKEN_WEIGHT = 0.4;

/** Penalty per version behind the newest copy of the same page, and its cap. */
const VERSION_PENALTY_PER_STEP = 0.15;
const VERSION_PENALTY_MAX = 0.3;

/** Penalty for each earlier chunk already taken from the same page. */
const PAGE_REPEAT_PENALTY = 0.07;

/**
 * Tests and config are indexed only when explicitly asked for, and even then
 * they answer "what is asserted", not "how does this behave".
 */
const SUPPORT_FILE_PENALTY = 0.2;

/** Shortest token that may match by prefix, so `timeout` reaches `timeouts`. */
const MIN_PREFIX_MATCH = 4;

/**
 * Feature weight for a query that is just a symbol name. These features exist to
 * help a prose question find the file that implements it; when the query *is* an
 * identifier the lexical leg already puts the definition first, and rewarding
 * filename overlap only lets a neighbouring file with a similar name interfere.
 */
const IDENTIFIER_QUERY_FEATURE_WEIGHT = 0.15;

/** Off switch, so the stage can be A/B'd against the previous ordering. */
export function lastMileRankEnabled(): boolean {
  const raw = process.env.LEDGEINDEX_LAST_MILE_RANK?.trim().toLowerCase();
  if (!raw) return true;
  return raw !== "0" && raw !== "false" && raw !== "off";
}

export type RankableChunk = {
  score: number;
  url: string;
  title: string;
  filePath?: string;
  symbolName?: string;
  symbolKind?: string;
  pageKind?: string;
};

type QueryIntent = "implementation" | "usage" | "concept";

/** Tokens of a path segment, split on separators and camel humps. */
function pathTokens(segment: string): string[] {
  return segment
    .replace(/\.[a-z0-9]+$/i, "")
    .split(/[^A-Za-z0-9]+/)
    .flatMap((part) => splitIdentifier(part));
}

function matchesTerm(term: string, token: string): boolean {
  if (term === token) return true;
  if (term.length >= MIN_PREFIX_MATCH && token.startsWith(term)) return true;
  if (token.length >= MIN_PREFIX_MATCH && term.startsWith(token)) return true;
  return false;
}

/**
 * Overlap between the question's terms and a name, scored from whichever side
 * is more informative.
 *
 * Coverage of the question alone is the wrong measure: a question has a dozen
 * content words and `timeouts.ts` can only ever contain one of them, so a
 * bullseye on the filename would score 0.1 and lose to noise. Coverage of the
 * name alone is equally wrong, since a one-word filename matched by one word
 * scores a perfect 1.0. Taking the larger of the two rewards a name that is
 * mostly made of query terms *and* a query that is mostly found in the name.
 */
function nameOverlap(terms: string[], tokens: string[]): number {
  if (terms.length === 0 || tokens.length === 0) return 0;

  let matchedTerms = 0;
  for (const term of terms) {
    if (tokens.some((token) => matchesTerm(term, token))) matchedTerms += 1;
  }
  if (matchedTerms === 0) return 0;

  let matchedTokens = 0;
  for (const token of tokens) {
    if (terms.some((term) => matchesTerm(term, token))) matchedTokens += 1;
  }

  return Math.max(matchedTerms / terms.length, matchedTokens / tokens.length);
}

/**
 * How much the chunk's location looks like the thing being asked about. The
 * filename carries full weight and the directories above it carry less.
 */
function pathScore(chunk: RankableChunk, terms: string[]): number {
  const path = chunk.filePath ?? chunk.title;
  if (!path) return 0;

  const segments = path.split(/[\\/]+/).filter(Boolean);
  if (segments.length === 0) return 0;

  const fileScore = nameOverlap(
    terms,
    pathTokens(segments[segments.length - 1] ?? ""),
  );
  const dirScore = nameOverlap(
    terms,
    segments.slice(0, -1).flatMap((segment) => pathTokens(segment)),
  );

  return Math.min(1, Math.max(fileScore, DIRECTORY_TOKEN_WEIGHT * dirScore));
}

function symbolScore(chunk: RankableChunk, terms: string[]): number {
  if (!chunk.symbolName) return 0;
  return nameOverlap(terms, splitIdentifier(chunk.symbolName));
}

/**
 * A lookup of a specific symbol — `WEBMCP_CHROME_FLAG`, `abortableDelay` — as
 * opposed to a question about behaviour. Short, and built from a compound
 * identifier rather than ordinary words.
 */
export function isIdentifierQuery(query: string): boolean {
  const words = query.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 2) return false;

  return words.some(
    (word) =>
      /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(word) &&
      /[A-Z_$0-9]/.test(word) &&
      splitIdentifier(word).length >= 2,
  );
}

export function classifyQueryIntent(query: string): QueryIntent {
  const text = query.toLowerCase();
  if (/\b(how does|how is|how are|where is|implemented|implementation|internally)\b/.test(text)) {
    return "implementation";
  }
  if (/\b(how do i|how to|example|snippet|usage|can i)\b/.test(text)) {
    return "usage";
  }
  return "concept";
}

/**
 * Mild preference for the kind of page that answers this shape of question.
 * Deliberately small: page kind is a hint, and a wrong guess should never
 * outweigh a direct path or symbol match.
 */
function kindScore(chunk: RankableChunk, intent: QueryIntent): number {
  const kind = chunk.pageKind ?? (chunk.filePath ? "source" : "docs");

  // Never useful as the answer to a question about behaviour.
  if (kind === "test" || kind === "config") return 0;

  switch (intent) {
    case "implementation":
      return kind === "source" ? 1 : kind === "docs" ? 0.4 : 0.6;
    case "usage":
      return kind === "example" ? 1 : kind === "source" ? 0.7 : 0.6;
    case "concept":
      return kind === "docs" ? 1 : kind === "source" ? 0.6 : 0.7;
  }
}

/**
 * Version key for a page that lives in a versioned docs tree, so `docs/v3/x`
 * and `docs/v4/x` are recognised as the same page. Handles the bare `vN`
 * convention and Docusaurus `versioned_docs/version-N`.
 */
function versionedPage(
  path: string,
): { group: string; version: number } | null {
  const patterns = [
    /(^|[\\/])v(\d+(?:\.\d+)*)([\\/])/i,
    /(^|[\\/])version-(\d+(?:\.\d+)*)([\\/])/i,
  ];

  for (const pattern of patterns) {
    const match = path.match(pattern);
    if (!match) continue;
    const version = Number.parseFloat(match[2] ?? "");
    if (!Number.isFinite(version)) continue;
    return {
      group: path.replace(pattern, "$1{v}$3"),
      version,
    };
  }
  return null;
}

/**
 * Reorder in place of the incoming ranking, keeping the same scores.
 * Returns the input untouched when nothing in it looks like code, so docs
 * retrieval is unaffected.
 */
export function applyLastMileRank<T extends RankableChunk>(
  chunks: T[],
  query: string,
): T[] {
  if (chunks.length < 2) return chunks;
  if (!chunks.some((chunk) => chunk.filePath)) return chunks;

  const terms = lexicalQueryTerms(query).filter((term) => term.length >= 3);
  const intent = classifyQueryIntent(query);

  const featureWeight = isIdentifierQuery(query)
    ? IDENTIFIER_QUERY_FEATURE_WEIGHT
    : FEATURE_WEIGHT;
  const baseWeight = 1 - featureWeight;

  // Newest version present per page group, so older copies can be demoted.
  const newestByGroup = new Map<string, number>();
  for (const chunk of chunks) {
    const versioned = versionedPage(chunk.filePath ?? chunk.title ?? "");
    if (!versioned) continue;
    const current = newestByGroup.get(versioned.group);
    if (current === undefined || versioned.version > current) {
      newestByGroup.set(versioned.group, versioned.version);
    }
  }

  const seenPerPage = new Map<string, number>();

  const scored = chunks.map((chunk, index) => {
    const base = 1 / (1 + index / RANK_SOFTNESS);

    const feature =
      PATH_WEIGHT * pathScore(chunk, terms) +
      SYMBOL_WEIGHT * symbolScore(chunk, terms) +
      KIND_WEIGHT * kindScore(chunk, intent);

    let penalty = 0;

    const kind = chunk.pageKind;
    if (kind === "test" || kind === "config") penalty += SUPPORT_FILE_PENALTY;

    const versioned = versionedPage(chunk.filePath ?? chunk.title ?? "");
    if (versioned) {
      const newest = newestByGroup.get(versioned.group) ?? versioned.version;
      const stepsBehind = newest - versioned.version;
      if (stepsBehind > 0) {
        penalty += Math.min(
          VERSION_PENALTY_MAX,
          stepsBehind * VERSION_PENALTY_PER_STEP,
        );
      }
    }

    const pageKey = chunk.url.trim() || (chunk.filePath ?? chunk.title ?? "");
    const alreadySeen = seenPerPage.get(pageKey) ?? 0;
    seenPerPage.set(pageKey, alreadySeen + 1);
    penalty += alreadySeen * PAGE_REPEAT_PENALTY;

    return {
      chunk,
      index,
      rank: baseWeight * base + featureWeight * feature - penalty,
    };
  });

  scored.sort((a, b) => b.rank - a.rank || a.index - b.index);

  // Reuse the incoming score distribution so downstream thresholds are stable.
  const scores = chunks
    .map((chunk) => chunk.score)
    .sort((a, b) => b - a);

  return scored.map((entry, position) => ({
    ...entry.chunk,
    score: scores[position] ?? entry.chunk.score,
  }));
}
