/**
 * Heuristic exclude-pattern discovery from a discovered URL list.
 * Mirrors the path/noise signals used by scripts/propose-docs-exclude-patterns.mjs
 * (without an LLM) so crawl review can optionally prefill excludes.
 */

const NOISE_SEGMENTS = new Set([
  "changelog",
  "changelogs",
  "blog",
  "blogs",
  "news",
  "release-notes",
  "releases",
  "tags",
  "tag",
  "authors",
  "author",
  "category",
  "categories",
  "archive",
  "archives",
  "legacy",
  "old",
  "canary",
  "nightly",
  "unstable",
  "preview",
  "alpha",
  "beta",
  "next",
  "versions",
  "version",
]);

const VERSIONISH_RE =
  /^(?:v\d+(?:\.\d+)*(?:-[a-z0-9.]+)?|version-\d+(?:\.\d+)*|\d+\.\d+(?:\.\d+)*(?:-[a-z0-9.]+)?)$/i;

export type DiscoverExcludePatternsOptions = {
  startUrls?: string[];
  existing?: string[];
  /** Cap how many new patterns to return. */
  maxPatterns?: number;
  /** Skip a pattern if it would drop more than this share of URLs. */
  maxDropRatio?: number;
  /** Minimum URL hits before a pattern is suggested. */
  minHits?: number;
};

function pathnameOf(url: string): string | null {
  try {
    return new URL(url).pathname;
  } catch {
    return null;
  }
}

function protectedPrefixes(startUrls: string[]): Set<string> {
  const protectedPaths = new Set<string>();
  for (const start of startUrls) {
    const path = pathnameOf(start);
    if (!path) continue;
    const parts = path.split("/").filter(Boolean);
    let cur = "";
    for (const part of parts) {
      cur += `/${part}`;
      protectedPaths.add(`${cur}/`.toLowerCase());
      protectedPaths.add(`/${part}/`.toLowerCase());
    }
  }
  return protectedPaths;
}

function matchesExclude(
  url: string,
  patterns: string[],
  patternsAreRegex = false,
): boolean {
  for (const pattern of patterns) {
    if (!pattern) continue;
    if (patternsAreRegex) {
      try {
        if (new RegExp(pattern).test(url)) return true;
      } catch {
        // ignore bad regex
      }
    } else if (url.includes(pattern)) {
      return true;
    }
  }
  return false;
}

function dropRatio(urls: string[], pattern: string): number {
  if (urls.length === 0) return 0;
  let dropped = 0;
  for (const url of urls) {
    if (url.includes(pattern)) dropped += 1;
  }
  return dropped / urls.length;
}

function hitCount(urls: string[], pattern: string): number {
  let hits = 0;
  for (const url of urls) {
    if (url.includes(pattern)) hits += 1;
  }
  return hits;
}

/**
 * Propose literal excludePatterns from discovered page URLs.
 * Never suggests a pattern that would match any start URL.
 */
export function discoverExcludePatternsFromUrls(
  urls: string[],
  options: DiscoverExcludePatternsOptions = {},
): string[] {
  const {
    startUrls = [],
    existing = [],
    maxPatterns = 12,
    maxDropRatio = 0.35,
    minHits = 2,
  } = options;

  if (urls.length === 0) return [];

  const existingSet = new Set(
    existing.map((pattern) => pattern.trim()).filter(Boolean),
  );
  const protectedPaths = protectedPrefixes(startUrls);
  const candidates = new Map<string, number>();

  const bump = (pattern: string, weight = 1) => {
    const key = pattern.trim();
    if (!key) return;
    if (existingSet.has(key)) return;
    if (protectedPaths.has(key.toLowerCase())) return;
    if (startUrls.some((start) => start.includes(key))) return;
    candidates.set(key, (candidates.get(key) || 0) + weight);
  };

  for (const url of urls) {
    const path = pathnameOf(url);
    if (!path) continue;
    const lower = path.toLowerCase();

    if (lower.endsWith("/all.html") || lower.endsWith("all.html")) {
      bump("all.html", 3);
    }

    const parts = path.split("/").filter(Boolean);
    for (let i = 0; i < parts.length; i += 1) {
      const segment = parts[i]!;
      const lowerSeg = segment.toLowerCase();
      const pattern = `/${segment}/`;

      if (NOISE_SEGMENTS.has(lowerSeg)) {
        bump(pattern, 2);
      }

      if (VERSIONISH_RE.test(segment)) {
        // Prefer compact version trees: /v1/, /2.0/, etc.
        bump(pattern, 1);
      }

      // Locale-ish 2-letter segments under docs roots are noisy when parallel.
      if (/^[a-z]{2}(?:-[a-z]{2})?$/i.test(segment) && i > 0) {
        const prev = parts[i - 1]?.toLowerCase();
        if (prev === "docs" || prev === "documentation" || prev === "guide") {
          bump(pattern, 1);
        }
      }
    }
  }

  // If multiple version-like first/second segments exist, keep the ones that
  // appear — discovery already skips protected start-url versions.
  const ranked = [...candidates.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  );

  const out: string[] = [];
  for (const [pattern] of ranked) {
    if (out.length >= maxPatterns) break;
    const hits = hitCount(urls, pattern);
    if (hits < minHits && pattern !== "all.html") continue;
    if (dropRatio(urls, pattern) > maxDropRatio) continue;
    // Don't stack overlapping patterns that are supersets of an already-chosen one.
    if (out.some((chosen) => pattern.includes(chosen) || chosen.includes(pattern))) {
      continue;
    }
    out.push(pattern);
  }

  return out;
}

export function mergeExcludePatterns(
  existing: string[],
  suggested: string[],
): string[] {
  const merged: string[] = [];
  const seen = new Set<string>();
  for (const pattern of [...existing, ...suggested]) {
    const key = pattern.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(key);
  }
  return merged;
}

export function filterUrlsByExcludePatterns(
  urls: string[],
  patterns: string[],
  patternsAreRegex = false,
): string[] {
  if (patterns.length === 0) return urls;
  return urls.filter(
    (url) => !matchesExclude(url, patterns, patternsAreRegex),
  );
}
