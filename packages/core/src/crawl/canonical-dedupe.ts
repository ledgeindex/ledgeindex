import { normalizeCanonicalUrl } from "../lib/canonical-url.js";
import type { DiscoveredUrl, SkippedUrl } from "./discover.js";

export const CANONICAL_DUPLICATE_PREFIX = "Canonical duplicate of ";

export function canonicalDuplicateReason(keptUrl: string): string {
  return `${CANONICAL_DUPLICATE_PREFIX}${keptUrl}`;
}

export function isCanonicalDuplicateSkip(reason: string): boolean {
  return reason.startsWith(CANONICAL_DUPLICATE_PREFIX);
}

/** Prefer bare paths over ?query and #hash variants when picking a canonical representative. */
function urlPreferenceScore(url: string): number {
  try {
    const parsed = new URL(url);
    return (parsed.search ? 1 : 0) + (parsed.hash ? 2 : 0);
  } catch {
    return 99;
  }
}

export function dedupeUrlsByCanonical(urls: readonly string[]): {
  unique: string[];
  skipped: SkippedUrl[];
} {
  const unique: string[] = [];
  const skipped: SkippedUrl[] = [];
  const canonicalIndex = new Map<string, number>();

  for (const url of urls) {
    const key = normalizeCanonicalUrl(url);
    if (!key) {
      unique.push(url);
      continue;
    }

    const existingIdx = canonicalIndex.get(key);
    if (existingIdx === undefined) {
      canonicalIndex.set(key, unique.length);
      unique.push(url);
      continue;
    }

    const keptUrl = unique[existingIdx]!;
    if (urlPreferenceScore(url) < urlPreferenceScore(keptUrl)) {
      skipped.push({ url: keptUrl, reason: canonicalDuplicateReason(url) });
      unique[existingIdx] = url;
    } else {
      skipped.push({ url, reason: canonicalDuplicateReason(keptUrl) });
    }
  }

  return { unique, skipped };
}

/**
 * Tracks discovered crawl URLs by canonical page identity (query/hash stripped).
 * Works for any docs site with SPA hash routes, tracking params, etc.
 */
export class CanonicalUrlRegistry {
  private readonly seenExact = new Set<string>();
  private readonly canonicalIndex = new Map<string, number>();

  constructor(
    private readonly urls: DiscoveredUrl[],
    private readonly skipped: SkippedUrl[],
    private readonly maxPages: number,
  ) {}

  hasExact(url: string): boolean {
    return this.seenExact.has(url);
  }

  markSeenExact(url: string) {
    this.seenExact.add(url);
  }

  tryRecord(url: string, title?: string): boolean {
    if (this.seenExact.has(url)) return false;
    if (this.urls.length >= this.maxPages) return false;

    this.seenExact.add(url);

    const key = normalizeCanonicalUrl(url);
    if (!key) {
      this.urls.push({ url, title });
      return true;
    }

    const existingIdx = this.canonicalIndex.get(key);
    if (existingIdx !== undefined) {
      const kept = this.urls[existingIdx]!;
      if (urlPreferenceScore(url) < urlPreferenceScore(kept.url)) {
        this.skipped.push({
          url: kept.url,
          reason: canonicalDuplicateReason(url),
        });
        this.urls[existingIdx] = {
          url,
          title: title ?? kept.title,
        };
      } else {
        this.skipped.push({
          url,
          reason: canonicalDuplicateReason(kept.url),
        });
      }
      return false;
    }

    this.canonicalIndex.set(key, this.urls.length);
    this.urls.push({ url, title });
    return true;
  }
}
