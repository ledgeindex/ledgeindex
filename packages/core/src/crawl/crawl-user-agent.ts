/**
 * Default crawl identity. Many doc hosts (Cloudflare / Zendesk) soft-block
 * obvious bot UAs with 403 challenges; a normal browser UA passes.
 */
export const DEFAULT_CRAWL_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

/** Optional polite bot UA for sites that allowlisted crawlers. */
export const IDENTIFIED_BOT_USER_AGENT =
  "LedgeIndexBot/1.0 (+https://ledgeindex.ai)";
