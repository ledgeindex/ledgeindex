const USER_AGENT =
  "Mozilla/5.0 (compatible; LedgeIndexPathPreview/0.1; +https://ledgeindex.dev)";

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

async function fetchText(url: string, timeoutMs: number): Promise<string | null> {
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  }
}

async function fetchSitemapLocs(sitemapUrl: string): Promise<string[]> {
  const xml = await fetchText(sitemapUrl, 20_000);
  if (!xml) return [];
  const urls: string[] = [];
  for (const match of xml.matchAll(SITEMAP_LOC_RE)) {
    const loc = match[1]?.trim();
    if (loc) urls.push(loc);
  }
  return urls;
}

async function fetchRobotsSitemaps(origin: string): Promise<string[]> {
  const text = await fetchText(`${origin}/robots.txt`, 10_000);
  if (!text) return [];
  const urls: string[] = [];
  for (const match of text.matchAll(ROBOTS_SITEMAP_RE)) {
    const loc = match[1]?.trim();
    if (loc) urls.push(loc);
  }
  return urls;
}

async function discoverSitemapUrls(startUrl: string): Promise<string[]> {
  const origin = new URL(startUrl).origin;
  const fromRobots = await fetchRobotsSitemaps(origin);
  const candidates = [
    ...fromRobots,
    `${origin}/sitemap.xml`,
    `${origin}/sitemap_index.xml`,
    `${origin}/sitemap-index.xml`,
  ];

  const pageUrls = new Set<string>();
  const queue = [...new Set(candidates)];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const sitemapUrl = queue.shift();
    if (!sitemapUrl || visited.has(sitemapUrl)) continue;
    visited.add(sitemapUrl);
    const locs = await fetchSitemapLocs(sitemapUrl);
    for (const loc of locs) {
      if (isSitemapReference(loc)) {
        if (!visited.has(loc)) queue.push(loc);
        continue;
      }
      pageUrls.add(loc);
    }
  }

  return [...pageUrls];
}

function normalizePathname(pathname: string): string {
  const trimmed = pathname.replace(/\/+$/, "");
  return trimmed || "/";
}

export function urlUnderStartPath(candidate: string, startUrl: string): boolean {
  try {
    const a = new URL(candidate);
    const b = new URL(startUrl);
    if (a.origin !== b.origin) return false;
    const base = normalizePathname(b.pathname);
    const path = normalizePathname(a.pathname);
    return path === base || path.startsWith(`${base}/`);
  } catch {
    return false;
  }
}

function matchesExclude(
  url: string,
  patterns: string[],
  patternsAreRegex: boolean,
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

export type PathPreviewCrawlResult = {
  startUrl: string;
  mode: "sitemap";
  sitemapTotal: number;
  underPathCount: number;
  excludedCount: number;
  count: number;
  urls: string[];
  truncated: boolean;
};

export type PathOverlapReport = {
  mode: "sitemap-overlaps";
  sitemapTotal: number;
  pathCount: number;
  nested: Array<{ parent: string; child: string }>;
  shared: Array<{ url: string; paths: string[] }>;
  sharedCount: number;
  sharedTruncated: boolean;
  paths: Array<{
    startUrl: string;
    count: number;
    exclusiveCount: number;
    truncated: boolean;
    nestedUnder: string[];
  }>;
};

function normalizeStartKey(url: string): string {
  return url.split("#")[0]!.replace(/\/+$/, "");
}

function collectUnderPath(input: {
  startUrl: string;
  sitemapUrls: string[];
  excludePatterns: string[];
  patternsAreRegex: boolean;
  maxUrls: number;
}): PathPreviewCrawlResult {
  const { startUrl, sitemapUrls, excludePatterns, patternsAreRegex, maxUrls } =
    input;
  const underPath: string[] = [];
  let excludedCount = 0;

  for (const url of sitemapUrls) {
    const clean = url.split("#")[0]!;
    if (!urlUnderStartPath(clean, startUrl)) continue;
    if (matchesExclude(clean, excludePatterns, patternsAreRegex)) {
      excludedCount += 1;
      continue;
    }
    underPath.push(clean);
  }

  const startKey = normalizeStartKey(startUrl);
  if (
    !underPath.some((url) => normalizeStartKey(url) === startKey) &&
    !matchesExclude(startUrl, excludePatterns, patternsAreRegex)
  ) {
    underPath.unshift(startUrl.split("#")[0]!);
  }

  underPath.sort((a, b) => a.localeCompare(b));
  const truncated = underPath.length > maxUrls;
  const urls = underPath.slice(0, maxUrls);

  return {
    startUrl,
    mode: "sitemap",
    sitemapTotal: sitemapUrls.length,
    underPathCount: underPath.length,
    excludedCount,
    count: urls.length,
    urls,
    truncated,
  };
}

export async function previewPathCrawl(input: {
  startUrl: string;
  excludePatterns?: string[];
  patternsAreRegex?: boolean;
  maxUrls?: number;
}): Promise<PathPreviewCrawlResult> {
  const startUrl = String(input.startUrl || "").trim();
  if (!startUrl) throw new Error("startUrl is required");
  let parsed: URL;
  try {
    parsed = new URL(startUrl);
  } catch {
    throw new Error("startUrl must be an absolute URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("startUrl must be http(s)");
  }

  const maxUrls = Math.min(
    5000,
    Math.max(20, Number(input.maxUrls) || 2000),
  );
  const excludePatterns = Array.isArray(input.excludePatterns)
    ? input.excludePatterns.map((row) => String(row || "").trim()).filter(Boolean)
    : [];
  const patternsAreRegex = Boolean(input.patternsAreRegex);
  const sitemapUrls = await discoverSitemapUrls(startUrl);

  return collectUnderPath({
    startUrl,
    sitemapUrls,
    excludePatterns,
    patternsAreRegex,
    maxUrls,
  });
}

export async function previewPathOverlaps(input: {
  startUrls: string[];
  excludePatterns?: string[];
  patternsAreRegex?: boolean;
  maxUrls?: number;
  maxShared?: number;
}): Promise<PathOverlapReport> {
  const startUrls = [
    ...new Set(
      (input.startUrls || [])
        .map((url) => String(url || "").trim())
        .filter(Boolean),
    ),
  ];
  if (startUrls.length < 2) {
    throw new Error("Need at least 2 path URLs to check overlaps");
  }
  for (const startUrl of startUrls) {
    let parsed: URL;
    try {
      parsed = new URL(startUrl);
    } catch {
      throw new Error(`Invalid URL: ${startUrl}`);
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error(`URL must be http(s): ${startUrl}`);
    }
  }

  const maxUrls = Math.min(
    5000,
    Math.max(20, Number(input.maxUrls) || 2000),
  );
  const maxShared = Math.min(
    500,
    Math.max(20, Number(input.maxShared) || 100),
  );
  const excludePatterns = Array.isArray(input.excludePatterns)
    ? input.excludePatterns.map((row) => String(row || "").trim()).filter(Boolean)
    : [];
  const patternsAreRegex = Boolean(input.patternsAreRegex);

  // One sitemap fetch for the package origin (use first start URL).
  const sitemapUrls = await discoverSitemapUrls(startUrls[0]!);
  const previews = startUrls.map((startUrl) =>
    collectUnderPath({
      startUrl,
      sitemapUrls,
      excludePatterns,
      patternsAreRegex,
      maxUrls,
    }),
  );

  const nested: Array<{ parent: string; child: string }> = [];
  for (const parent of startUrls) {
    for (const child of startUrls) {
      if (parent === child) continue;
      if (urlUnderStartPath(child, parent) && !urlUnderStartPath(parent, child)) {
        nested.push({ parent, child });
      }
    }
  }

  // Shared pages across paths that are not simply nested under another selected path.
  // Still report all multi-path membership so nested waste is visible.
  const owners = new Map<string, string[]>();
  for (const preview of previews) {
    for (const url of preview.urls) {
      const list = owners.get(url) ?? [];
      if (!list.includes(preview.startUrl)) list.push(preview.startUrl);
      owners.set(url, list);
    }
  }

  const sharedAll: Array<{ url: string; paths: string[] }> = [];
  for (const [url, paths] of owners) {
    if (paths.length < 2) continue;
    sharedAll.push({ url, paths: [...paths].sort() });
  }
  sharedAll.sort((a, b) => b.paths.length - a.paths.length || a.url.localeCompare(b.url));

  const exclusiveCounts = new Map<string, number>();
  for (const preview of previews) exclusiveCounts.set(preview.startUrl, 0);
  for (const [url, paths] of owners) {
    if (paths.length !== 1) continue;
    const owner = paths[0]!;
    exclusiveCounts.set(owner, (exclusiveCounts.get(owner) || 0) + 1);
    void url;
  }

  return {
    mode: "sitemap-overlaps",
    sitemapTotal: sitemapUrls.length,
    pathCount: startUrls.length,
    nested,
    shared: sharedAll.slice(0, maxShared),
    sharedCount: sharedAll.length,
    sharedTruncated: sharedAll.length > maxShared,
    paths: previews.map((preview) => ({
      startUrl: preview.startUrl,
      count: preview.count,
      exclusiveCount: exclusiveCounts.get(preview.startUrl) || 0,
      truncated: preview.truncated,
      nestedUnder: nested
        .filter(
          (row) =>
            normalizeStartKey(row.child) === normalizeStartKey(preview.startUrl),
        )
        .map((row) => row.parent),
    })),
  };
}
