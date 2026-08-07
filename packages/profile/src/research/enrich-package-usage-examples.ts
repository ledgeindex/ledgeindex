import { normalizeCatalogUrl } from "./catalog-pick-fallback.js";
import type { FetchedPage } from "./fetch-picked-pages.js";
import type { PackageUsageExamplesLensOutput } from "./research-lenses.js";

function markdownByNormalizedUrl(pages: FetchedPage[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const page of pages) {
    const md = page.markdown.trim();
    if (!md) continue;
    map.set(normalizeCatalogUrl(page.url), md);
  }
  return map;
}

function lookupPageMarkdown(
  citeUrl: string | undefined,
  byUrl: Map<string, string>,
): string | undefined {
  if (!citeUrl?.trim()) return undefined;
  const direct = byUrl.get(normalizeCatalogUrl(citeUrl));
  if (direct) return direct;
  try {
    const target = new URL(citeUrl.trim());
    for (const [key, md] of byUrl) {
      try {
        const parsed = new URL(key);
        if (parsed.origin === target.origin && parsed.pathname === target.pathname) {
          return md;
        }
      } catch {
        continue;
      }
    }
  } catch {
    /* ignore */
  }
  return undefined;
}

/** Attach full fetched page markdown to each example (matched via citation URL). */
export function enrichPackageUsageExamplesWithFetchedPages(
  data: PackageUsageExamplesLensOutput,
  fetched: FetchedPage[],
): PackageUsageExamplesLensOutput {
  const byUrl = markdownByNormalizedUrl(fetched);
  if (byUrl.size === 0) return data;

  return {
    ...data,
    examples: data.examples.map((example) => {
      const md = lookupPageMarkdown(example.citation?.url, byUrl);
      if (!md) return example;
      return { ...example, pageMarkdown: md };
    }),
  };
}

export function pageMarkdownByUrlFromFetched(
  fetched: FetchedPage[],
): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const page of fetched) {
    const md = page.markdown.trim();
    if (!md) continue;
    out[page.url] = md;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
