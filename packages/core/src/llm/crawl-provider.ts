import { isLocalHostingDeployment } from "../db/source-hosting.js";
import {
  hasDeepSeekKey,
  hasGoogleGenerativeKey,
  hasOpenAiKey,
} from "../vector/config.js";

export type CrawlProviderId = "google" | "openai" | "deepseek";

export const CRAWL_PROVIDER_MODEL_IDS: Record<CrawlProviderId, string> = {
  google: "google/gemini-3.5-flash-lite",
  openai: "openai/gpt-5.4-mini",
  deepseek: "deepseek/deepseek-v4-flash",
};

const PROVIDER_IDS: CrawlProviderId[] = ["google", "openai", "deepseek"];

export function parseCrawlProviderId(raw: unknown): CrawlProviderId | null {
  if (raw === "google" || raw === "openai" || raw === "deepseek") return raw;
  return null;
}

function keyForProvider(id: CrawlProviderId): boolean {
  switch (id) {
    case "google":
      return hasGoogleGenerativeKey();
    case "openai":
      return hasOpenAiKey();
    case "deepseek":
      return hasDeepSeekKey();
  }
}

export function availableCrawlProviders(): CrawlProviderId[] {
  const choosable = isLocalHostingDeployment();
  return PROVIDER_IDS.filter((id) =>
    choosable ? keyForProvider(id) : id === "google" && keyForProvider(id),
  );
}

/**
 * Local/self-host: LEDGEINDEX_CRAWL_PROVIDER if that key exists, else first keyed
 * provider. Hosted prod stays on Google.
 */
export function resolveConfiguredCrawlProvider(): CrawlProviderId | null {
  const available = availableCrawlProviders();
  if (available.length === 0) return null;
  if (!isLocalHostingDeployment()) return "google";

  const fromEnv = parseCrawlProviderId(
    process.env.LEDGEINDEX_CRAWL_PROVIDER?.trim().toLowerCase(),
  );
  if (fromEnv && available.includes(fromEnv)) return fromEnv;
  return available[0] ?? null;
}

export function crawlModelIdForProvider(id: CrawlProviderId): string {
  return CRAWL_PROVIDER_MODEL_IDS[id];
}
