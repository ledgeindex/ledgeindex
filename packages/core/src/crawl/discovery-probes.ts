import { discoverSitemapUrls, parentScopePathForLandingSeed } from "./sitemap.js";
import { getStartUrlScopes, isWithinStartUrlScope } from "./url-matcher.js";

const ROBOTS_SITEMAP_RE = /^sitemap:\s*(\S+)/gim;
const SITEMAP_LOC_RE = /<loc>\s*[^<\s]+\s*<\/loc>/i;

export type DiscoverySignal = {
  found: boolean;
  url: string;
};

export type RobotsDiscoverySignal = DiscoverySignal & {
  disallowRules?: number;
};

export type SitemapDiscoverySignal = DiscoverySignal & {
  pageCount?: number;
};

export type DiscoverySignals = {
  robots: RobotsDiscoverySignal;
  sitemap: SitemapDiscoverySignal;
};

async function fetchText(
  url: string,
  userAgent: string,
  timeoutMs = 12_000,
): Promise<{ ok: boolean; text: string }> {
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": userAgent },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return { ok: false, text: "" };
    return { ok: true, text: await response.text() };
  } catch {
    return { ok: false, text: "" };
  }
}

export async function probeRobotsTxt(
  origin: string,
  userAgent: string,
): Promise<RobotsDiscoverySignal & { body?: string }> {
  const url = `${origin}/robots.txt`;
  const { ok, text } = await fetchText(url, userAgent);
  if (!ok || !text.trim()) {
    return { found: false, url };
  }

  const disallowRules = (text.match(/^disallow:/gim) ?? []).length;

  return {
    found: true,
    url,
    disallowRules,
    body: text,
  };
}

function collectSitemapCandidates(
  origin: string,
  robotsBody?: string,
  customSitemapUrls: string[] = [],
): string[] {
  const candidates = new Set<string>([
    ...customSitemapUrls,
    `${origin}/sitemap.xml`,
    `${origin}/sitemap_index.xml`,
    `${origin}/sitemap-index.xml`,
  ]);

  if (robotsBody) {
    for (const match of robotsBody.matchAll(ROBOTS_SITEMAP_RE)) {
      const raw = match[1]?.trim();
      if (!raw) continue;
      try {
        candidates.add(new URL(raw, origin).href);
      } catch {
        // ignore invalid sitemap URLs in robots.txt
      }
    }
  }

  return [...candidates];
}

export async function probeSitemap(
  origin: string,
  userAgent: string,
  options?: { robotsBody?: string; customSitemapUrls?: string[] },
): Promise<DiscoverySignal> {
  const candidates = collectSitemapCandidates(
    origin,
    options?.robotsBody,
    options?.customSitemapUrls,
  );

  for (const sitemapUrl of candidates) {
    const { ok, text } = await fetchText(sitemapUrl, userAgent);
    if (!ok || !SITEMAP_LOC_RE.test(text)) continue;
    return { found: true, url: sitemapUrl };
  }

  return { found: false, url: `${origin}/sitemap.xml` };
}

/** Scope used for sitemap page counts — includes parent for landing seeds. */
function sitemapCountScopeUrls(startUrl: string): string[] {
  const urls = [startUrl];
  const parent = parentScopePathForLandingSeed(startUrl);
  if (parent) urls.push(parent);
  return urls;
}

export async function probeDiscoverySignals(
  startUrl: string,
  userAgent: string,
  customSitemapUrls: string[] = [],
): Promise<DiscoverySignals> {
  const origin = new URL(startUrl).origin;
  const robots = await probeRobotsTxt(origin, userAgent);
  const sitemap = await probeSitemap(origin, userAgent, {
    robotsBody: robots.body,
    customSitemapUrls,
  });

  let pageCount: number | undefined;
  if (sitemap.found) {
    try {
      const urls = await discoverSitemapUrls(
        [startUrl],
        customSitemapUrls,
        userAgent,
      );
      const scopes = getStartUrlScopes(sitemapCountScopeUrls(startUrl));
      pageCount = urls.filter((url) => isWithinStartUrlScope(url, scopes)).length;
    } catch {
      // Sitemap exists but page count is optional metadata.
    }
  }

  return {
    robots: {
      found: robots.found,
      url: robots.url,
      disallowRules: robots.disallowRules,
    },
    sitemap: {
      ...sitemap,
      pageCount,
    },
  };
}
