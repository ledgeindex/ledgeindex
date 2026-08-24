import type { MetadataRoute } from "next";
import { getSiteUrl } from "@/lib/site-url";

const LOC_RE = /<loc>\s*([^<\s]+)\s*<\/loc>/gi;

const DEFAULT_DOCS_SITEMAP_ORIGINS = [
  "https://pindownai-docs.vercel.app",
  "https://docs.ledgeindex.com",
] as const;

const DOCS_PATH_PREFIXES = ["/docs", "/guides", "/reference"] as const;

function docsSitemapOrigins(): string[] {
  const fromEnv = process.env.LEDGEINDEX_DOCS_SITEMAP_ORIGIN?.trim();
  if (fromEnv) return [fromEnv.replace(/\/$/, "")];
  return [...DEFAULT_DOCS_SITEMAP_ORIGINS];
}

function isDocsPath(pathname: string): boolean {
  if (pathname === "/") return false;
  return DOCS_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function rewriteLocToApex(loc: string, apex: string): string | null {
  try {
    const url = new URL(loc);
    let path = url.pathname;
    if (path.endsWith("/") && path.length > 1) path = path.slice(0, -1);
    if (!isDocsPath(path)) return null;
    return `${apex}${path}`;
  } catch {
    return null;
  }
}

function parseSitemapLocs(xml: string): string[] {
  return [...xml.matchAll(LOC_RE)].map((match) => match[1]!.trim()).filter(Boolean);
}

async function fetchDocsSitemapLocs(origin: string): Promise<string[]> {
  const response = await fetch(`${origin}/sitemap.xml`, {
    next: { revalidate: 3600 },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) return [];
  const xml = await response.text();
  return parseSitemapLocs(xml);
}

export async function fetchDocsSitemapEntries(
  apex: string,
): Promise<MetadataRoute.Sitemap> {
  for (const origin of docsSitemapOrigins()) {
    try {
      const locs = await fetchDocsSitemapLocs(origin);
      if (locs.length === 0) continue;

      const urls = new Set<string>();
      for (const loc of locs) {
        const rewritten = rewriteLocToApex(loc, apex);
        if (rewritten) urls.add(rewritten);
      }

      if (urls.size > 0) {
        return [...urls].sort().map((url) => ({
          url,
          changeFrequency: "weekly" as const,
          priority: 0.8,
        }));
      }
    } catch {
      // try next origin
    }
  }

  return [];
}

export const PUBLIC_MARKETING_PATHS: readonly string[] = [
  "/about",
  "/contact",
  "/privacy",
  "/login",
  "/llms.txt",
  "/openapi.json",
];

export function marketingSitemapEntries(
  apex: string,
): MetadataRoute.Sitemap {
  const home: MetadataRoute.Sitemap = [
    {
      url: apex,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 1,
    },
  ];

  const pages: MetadataRoute.Sitemap = PUBLIC_MARKETING_PATHS.map((path) => ({
    url: `${apex}${path}`,
    lastModified: new Date(),
    changeFrequency: "monthly" as const,
    priority: 0.7,
  }));

  return [...home, ...pages];
}

export async function buildApexSitemap(): Promise<MetadataRoute.Sitemap> {
  const apex = getSiteUrl();
  const marketing = marketingSitemapEntries(apex);
  const docs = await fetchDocsSitemapEntries(apex);

  const byUrl = new Map<string, MetadataRoute.Sitemap[number]>();
  for (const entry of [...marketing, ...docs]) {
    byUrl.set(entry.url, entry);
  }

  return [...byUrl.values()].sort((a, b) => a.url.localeCompare(b.url));
}
