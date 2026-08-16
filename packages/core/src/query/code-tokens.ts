/**
 * Tokenization shared by the lexical index and lexical queries.
 *
 * Dense retrieval is weak on rare tokens, which is most of what identifies
 * code: `observeHandler`, `StagehandPage`, a message copied out of a stack
 * trace. The lexical leg covers those, but only if `observeHandler` is also
 * findable as `observe` and `handler` — so identifiers are split at index time
 * and at query time using the same rules.
 */

const IDENTIFIER_PATTERN = /[A-Za-z_$][A-Za-z0-9_$]*/g;

/** Cap on generated tokens per chunk, so the appended block stays bounded. */
const MAX_EXPANDED_TOKENS = 400;
/** Cap on query terms, so a long question does not produce a huge tsquery. */
const MAX_QUERY_TERMS = 24;

/**
 * Words that carry no retrieval signal in a developer question. Deliberately
 * short: dropping domain words would defeat the purpose of a lexical leg.
 */
const QUERY_STOPWORDS = new Set([
  "a",
  "about",
  "all",
  "also",
  "an",
  "and",
  "any",
  "are",
  "as",
  "at",
  "be",
  "been",
  "but",
  "by",
  "can",
  "could",
  "did",
  "do",
  "does",
  "for",
  "from",
  "get",
  "give",
  "has",
  "have",
  "how",
  "i",
  "if",
  "in",
  "into",
  "is",
  "it",
  "its",
  "just",
  "know",
  "like",
  "me",
  "my",
  "need",
  "no",
  "not",
  "of",
  "on",
  "one",
  "only",
  "or",
  "our",
  "out",
  "over",
  "please",
  "should",
  "show",
  "so",
  "some",
  "tell",
  "than",
  "that",
  "the",
  "their",
  "them",
  "then",
  "there",
  "these",
  "they",
  "this",
  "to",
  "up",
  "us",
  "use",
  "want",
  "was",
  "we",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "will",
  "with",
  "would",
  "you",
  "your",
]);

/** Split an identifier on camel humps, underscores, and digit boundaries. */
export function splitIdentifier(identifier: string): string[] {
  const parts = identifier
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/([A-Za-z])([0-9])/g, "$1 $2")
    .replace(/([0-9])([A-Za-z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .map((part) => part.toLowerCase())
    .filter(Boolean);

  // Rejoin single characters onto the next part: `XPathResolver` splits to
  // x/path/resolver, and dropping the `x` loses the word people search for.
  const merged: string[] = [];
  let carry = "";
  for (const part of parts) {
    if (part.length === 1) {
      carry += part;
      continue;
    }
    merged.push(carry ? `${carry}${part}` : part);
    carry = "";
  }
  if (carry.length >= 2) merged.push(carry);

  return merged.filter((part) => part.length >= 2);
}

/** Sub-word tokens implied by the compound identifiers in a piece of text. */
export function identifierSubTokens(text: string): string[] {
  const extra = new Set<string>();

  for (const identifier of text.match(IDENTIFIER_PATTERN) ?? []) {
    if (extra.size >= MAX_EXPANDED_TOKENS) break;
    // A flat lowercase word is already indexed as itself.
    if (!/[A-Z_$0-9]/.test(identifier)) continue;
    const parts = splitIdentifier(identifier);
    if (parts.length < 2) continue;
    for (const part of parts) {
      if (extra.size >= MAX_EXPANDED_TOKENS) break;
      extra.add(part);
    }
  }

  return [...extra];
}

/**
 * Text to store in the lexical index: the original body plus a trailing block
 * of split identifier parts. Appending keeps the body verbatim for snippets
 * while making sub-words matchable.
 */
export function expandIdentifiersForIndex(text: string): string {
  const extra = identifierSubTokens(text);
  if (extra.length === 0) return text;
  return `${text}\n\n/* tokens: ${extra.join(" ")} */`;
}

/**
 * Terms for a lexical query, most specific first. Identifiers in the question
 * contribute both the whole identifier and its parts.
 */
export function lexicalQueryTerms(query: string): string[] {
  const terms: string[] = [];
  const seen = new Set<string>();

  const push = (term: string) => {
    const normalized = term.toLowerCase();
    if (normalized.length < 2) return;
    if (QUERY_STOPWORDS.has(normalized)) return;
    if (seen.has(normalized)) return;
    seen.add(normalized);
    terms.push(normalized);
  };

  for (const identifier of query.match(IDENTIFIER_PATTERN) ?? []) {
    push(identifier);
    if (/[A-Z_$0-9]/.test(identifier)) {
      for (const part of splitIdentifier(identifier)) push(part);
    }
  }

  return terms.slice(0, MAX_QUERY_TERMS);
}

/**
 * The high-weight field for a chunk: where it lives and what it is called.
 * For code that is the file path and symbol path, for docs the page title and
 * heading trail — the strongest signal either way, and far shorter than the
 * body, so BM25 rewards it without a hand-tuned boost.
 */
export function lexicalHeadingFor(metadata: Record<string, unknown>): string {
  const parts: string[] = [];
  const push = (value: unknown) => {
    if (typeof value === "string" && value.trim()) parts.push(value.trim());
  };

  push(metadata.filePath);
  push(metadata.symbolPath);
  push(metadata.symbolName);
  push(metadata.title);
  push(metadata.section);
  push(metadata.category);
  if (Array.isArray(metadata.headingPath)) {
    for (const heading of metadata.headingPath) push(heading);
  }

  const heading = [...new Set(parts)].join(" ");
  const subTokens = identifierSubTokens(heading);
  return subTokens.length ? `${heading} ${subTokens.join(" ")}` : heading;
}

/** `to_tsquery('simple', …)` input: sanitized terms OR-ed together. */
export function toPostgresTsQuery(terms: string[]): string {
  return terms
    .map((term) => term.replace(/[^a-z0-9_]/gi, ""))
    .filter((term) => term.length >= 2)
    .join(" | ");
}

/** FTS5 MATCH input: quoted terms OR-ed together. */
export function toFts5MatchQuery(terms: string[]): string {
  return terms
    .map((term) => term.replace(/["']/g, ""))
    .filter((term) => term.length >= 2)
    .map((term) => `"${term}"`)
    .join(" OR ");
}
