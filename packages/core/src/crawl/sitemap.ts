const SITEMAP_LOC_RE = /<loc>\s*([^<\s]+)\s*<\/loc>/gi;
const ROBOTS_SITEMAP_RE = /^\s*Sitemap:\s*(\S+)\s*$/gim;

function isSitemapReference(url: string): boolean {
  try {
    const path = new URL(url).pathname.toLowerCase();
    return path.endsWith(".xml") || path.includes("sitemap");
  } catch {
    return false;
  }
}

export async function fetchSitemapUrls(
  sitemapUrl: string,
  userAgent: string,
): Promise<string[]> {
  const response = await fetch(sitemapUrl, {
    headers: { "User-Agent": userAgent },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) return [];

  const xml = await response.text();
  const urls: string[] = [];
  for (const match of xml.matchAll(SITEMAP_LOC_RE)) {
    const loc = match[1]?.trim();
    if (loc) urls.push(loc);
  }
  return urls;
}

/** Read `Sitemap:` entries from robots.txt for an origin. */
export async function fetchRobotsSitemapUrls(
  origin: string,
  userAgent: string,
): Promise<string[]> {
  try {
    const response = await fetch(new URL("/robots.txt", origin), {
      headers: { "User-Agent": userAgent },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return [];
    const text = await response.text();
    const urls: string[] = [];
    for (const match of text.matchAll(ROBOTS_SITEMAP_RE)) {
      const loc = match[1]?.trim();
      if (loc) urls.push(loc);
    }
    return urls;
  } catch {
    return [];
  }
}

export async function discoverSitemapUrls(
  startUrls: string[],
  customSitemapUrls: string[],
  userAgent: string,
): Promise<string[]> {
  const origins = [...new Set(startUrls.map((url) => new URL(url).origin))];
  const fromRobots = (
    await Promise.all(
      origins.map((origin) => fetchRobotsSitemapUrls(origin, userAgent)),
    )
  ).flat();

  const candidates = [
    ...customSitemapUrls,
    ...fromRobots,
    ...origins.flatMap((origin) => [
      `${origin}/sitemap.xml`,
      `${origin}/sitemap_index.xml`,
      `${origin}/sitemap-index.xml`,
    ]),
  ];

  const pageUrls = new Set<string>();
  const queue = [...new Set(candidates)];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const sitemapUrl = queue.shift();
    if (!sitemapUrl || visited.has(sitemapUrl)) continue;
    visited.add(sitemapUrl);

    try {
      const locs = await fetchSitemapUrls(sitemapUrl, userAgent);
      for (const loc of locs) {
        if (isSitemapReference(loc)) {
          if (!visited.has(loc)) queue.push(loc);
          continue;
        }
        pageUrls.add(loc);
      }
    } catch {
      // ignore unreachable sitemaps
    }
  }

  return [...pageUrls];
}

/**
 * Expand one or more sitemap / sitemap-index URLs into page URLs
 * (follows nested sitemap references).
 */
export async function expandSitemapPageUrls(
  sitemapRoots: string[],
  userAgent: string,
  options?: { maxPages?: number },
): Promise<string[]> {
  const maxPages = options?.maxPages ?? 50_000;
  const pageUrls = new Set<string>();
  const queue = [...new Set(sitemapRoots.map((url) => url.trim()).filter(Boolean))];
  const visited = new Set<string>();

  while (queue.length > 0 && pageUrls.size < maxPages) {
    const sitemapUrl = queue.shift();
    if (!sitemapUrl || visited.has(sitemapUrl)) continue;
    visited.add(sitemapUrl);

    try {
      const locs = await fetchSitemapUrls(sitemapUrl, userAgent);
      for (const loc of locs) {
        if (pageUrls.size >= maxPages) break;
        if (isSitemapReference(loc)) {
          if (!visited.has(loc)) queue.push(loc);
          continue;
        }
        pageUrls.add(loc);
      }
    } catch {
      // ignore unreachable sitemaps
    }
  }

  return [...pageUrls];
}

/**
 * Parent path for a start URL leaf (`/docs/intro` → `/docs`,
 * `/components/attachments` → `/components`).
 * Multi-start crawls need this so a second page URL includes sibling
 * pages under the same section, not only that exact leaf prefix.
 */
export function parentScopePathForLandingSeed(startUrl: string): string | null {
  try {
    const parsed = new URL(startUrl);
    const parts = parsed.pathname.replace(/\/+$/, "").split("/").filter(Boolean);
    if (parts.length < 2) return null;
    parsed.pathname = `/${parts.slice(0, -1).join("/")}`;
    parsed.hash = "";
    parsed.search = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}
