export type CrawlProviderId = "google" | "openai" | "deepseek";

const STORAGE_KEY = "ledgeindex:crawl-provider";

export const CRAWL_PROVIDER_MODEL_IDS: Record<CrawlProviderId, string> = {
  google: "google/gemini-3.5-flash-lite",
  openai: "openai/gpt-5.4-mini",
  deepseek: "deepseek/deepseek-v4-flash",
};

export function isCrawlProviderId(value: unknown): value is CrawlProviderId {
  return value === "google" || value === "openai" || value === "deepseek";
}

export function readCrawlProvider(): CrawlProviderId | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return isCrawlProviderId(raw) ? raw : null;
  } catch {
    return null;
  }
}

export function writeCrawlProvider(id: CrawlProviderId | null): void {
  if (typeof window === "undefined") return;
  if (!id) {
    window.localStorage.removeItem(STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(STORAGE_KEY, id);
}

export function crawlModelIdForProvider(id: CrawlProviderId): string {
  return CRAWL_PROVIDER_MODEL_IDS[id];
}
