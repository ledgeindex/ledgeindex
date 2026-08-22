import { discoverSitemapUrls, parentScopePathForLandingSeed } from "./sitemap.js";
import { getStartUrlScopes, isWithinStartUrlScope } from "./url-matcher.js";
import type { HeaderNavPath } from "./header-nav-paths.js";

export type { HeaderNavPath } from "./header-nav-paths.js";

const ROBOTS_SITEMAP_RE = /^sitemap:\s*(\S+)/gim;
const SITEMAP_LOC_RE = /<loc>\s*[^<\s]+\s*<\/loc>/i;

export type DiscoverySignal = {
  found: boolean;
  url: string;
};

export type RobotsDiscoverySignal = DiscoverySignal & {
  disallowRules?: number;
};

export type SitemapCandidate = {
  url: string;
  reachable: boolean;
};

export type SitemapDiscoverySignal = DiscoverySignal & {
  pageCount?: number;
  /** All probed sitemap URLs (robots + common paths + custom). */
  candidates?: SitemapCandidate[];
};

export type DiscoverySignals = {
  robots: RobotsDiscoverySignal;
  sitemap: SitemapDiscoverySignal;
  /** Sibling docs roots from the site header, when present. */
  navPaths?: HeaderNavPath[];
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
): Promise<SitemapDiscoverySignal> {
  const candidates = collectSitemapCandidates(
    origin,
    options?.robotsBody,
    options?.customSitemapUrls,
  );

  const probed: SitemapCandidate[] = [];
  let firstFound: string | null = null;

  for (const sitemapUrl of candidates) {
    const { ok, text } = await fetchText(sitemapUrl, userAgent);
    const reachable = ok && SITEMAP_LOC_RE.test(text);
    probed.push({ url: sitemapUrl, reachable });
    if (reachable && !firstFound) firstFound = sitemapUrl;
  }

  if (firstFound) {
    return { found: true, url: firstFound, candidates: probed };
  }

  return {
    found: false,
    url: `${origin}/sitemap.xml`,
    candidates: probed,
  };
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
