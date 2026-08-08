import { parsePage } from "@ledgeindex/core/extract/parser/extract-content.js";
import type { SiteCatalogPage } from "./crawl-catalog.js";

export type FetchedPage = {
  url: string;
  title: string;
  markdownChars: number;
  markdown: string;
  error?: string;
};

export type FetchPickedPagesResult = {
  pages: FetchedPage[];
  concurrency: number;
};

const DEFAULT_USER_AGENT = "LedgeIndexCompanyBot/1.0";
export const EXTERNAL_FETCH_MAX_CONCURRENCY = 10;

export function fetchConcurrencyForModel(modelId: string): number {
  return modelId.trim().toLowerCase().startsWith("lmstudio/") ? 1 : EXTERNAL_FETCH_MAX_CONCURRENCY;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]!);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  );
  return results;
}

/** Fetch markdown for picker-selected URLs (no LLM). */
export async function fetchPickedPages(
  picked: SiteCatalogPage[],
  options?: { userAgent?: string; modelId?: string; maxConcurrency?: number },
): Promise<FetchPickedPagesResult> {
  const userAgent = options?.userAgent ?? DEFAULT_USER_AGENT;
  const modelId = options?.modelId ?? "lmstudio/local";
  const concurrency =
    options?.maxConcurrency ?? fetchConcurrencyForModel(modelId);

  const pages = await mapWithConcurrency(picked, concurrency, async (page) => {
    try {
      const parsed = await parsePage(page.url, [], [], userAgent);
      const markdown = parsed.markdown.trim();
      return {
        url: parsed.url,
        title: parsed.title,
        markdownChars: markdown.length,
        markdown,
      };
    } catch (error) {
      return {
        url: page.url,
        title: page.title,
        markdownChars: 0,
        markdown: "",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  return { pages, concurrency };
}
