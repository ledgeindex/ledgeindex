import * as cheerio from "cheerio";
import type { CheerioAPI } from "cheerio";
import {
  probeDiscoverySignals,
  type DiscoverySignals,
} from "./discovery-probes.js";
import { classifySource } from "./classify-source.js";
import { fetchPageHtml } from "../extract/parser/extract-content.js";
import type { SourceMetadata } from "../schemas/source-metadata.js";
import { DEFAULT_CRAWL_USER_AGENT } from "./crawl-user-agent.js";
import {
  assertHtmlStartUrl,
  isPdfContentType,
  UnsupportedStartUrlError,
  UNSUPPORTED_PDF_START_URL_MESSAGE,
} from "../lib/unsupported-start-url.js";
import {
  hostnameLabel,
  looksLikeDocPageTitle,
  registrableDomain,
  siteNameFromUrl,
  siteSlugFromUrl,
} from "../lib/site-label-from-url.js";

export type PreflightResult = {
  url: string;
  ok: boolean;
  status: number;
  siteName: string;
  /** Stable slug from the site's registrable domain (e.g. mastra.ai → mastra). */
  siteSlug: string;
  title?: string;
  ogImage?: string;
  faviconUrl?: string;
  discovery: DiscoverySignals;
  metadata: SourceMetadata;
};

function resolveAbsoluteUrl(baseUrl: string, value?: string) {
  if (!value?.trim()) return undefined;
  try {
    return new URL(value.trim(), baseUrl).href;
  } catch {
    return undefined;
  }
}

function cleanTitleForSourceName(title: string) {
  const trimmed = title.trim();
  if (!trimmed) return "";

  const segment = trimmed.split(/\s*[|\-–—:]\s*/)[0]?.trim();
  return segment || trimmed;
}

function parseIconSize(sizes: string | undefined): number {
  if (!sizes?.trim()) return 0;
  const match = sizes.match(/(\d+)\s*x\s*(\d+)/i);
  if (!match) return 0;
  return Math.max(Number(match[1]), Number(match[2])) || 0;
}

type FaviconExtraction = {
  url?: string;
  /** True when a `<link rel="icon">` (or similar) tag was found on the page. */
  hasLinkTag: boolean;
};

function extractFaviconUrl($: CheerioAPI, pageUrl: string): FaviconExtraction {
  const candidates: { url: string; score: number }[] = [];

  $("link[rel]").each((_, el) => {
    const rel = ($(el).attr("rel") ?? "").toLowerCase();
    if (!/(^|\s)(icon|shortcut icon|apple-touch-icon)(\s|$)/.test(rel)) return;

    const href = resolveAbsoluteUrl(pageUrl, $(el).attr("href"));
    if (!href) return;

    let score = parseIconSize($(el).attr("sizes"));
    if (rel.includes("apple-touch-icon")) score += 256;
    if (href.endsWith(".svg")) score += 48;
    if (href.endsWith(".png")) score += 24;
    candidates.push({ url: href, score });
  });

  if (candidates.length > 0) {
    candidates.sort((a, b) => b.score - a.score);
    return { url: candidates[0]!.url, hasLinkTag: true };
  }

  return {
    url: resolveAbsoluteUrl(pageUrl, "/favicon.ico"),
    hasLinkTag: false,
  };
}

function extractOgImage($: CheerioAPI, pageUrl: string): string | undefined {
  return (
    resolveAbsoluteUrl(pageUrl, $('meta[property="og:image"]').attr("content")) ||
    resolveAbsoluteUrl(pageUrl, $('meta[name="twitter:image"]').attr("content")) ||
    resolveAbsoluteUrl(
      pageUrl,
      $('meta[name="twitter:image:src"]').attr("content"),
    )
  );
}

const BRANDING_ASSET_TIMEOUT_MS = 10_000;

function isImageContentType(contentType: string): boolean {
  const normalized = contentType.toLowerCase();
  if (!normalized) return true;
  return (
    normalized.startsWith("image/") ||
    normalized.includes("svg") ||
    normalized.includes("icon")
  );
}

async function isReachableBrandingAsset(
  url: string | undefined,
  userAgent: string,
): Promise<boolean> {
  if (!url) return false;

  const request = async (method: "HEAD" | "GET", headers?: Record<string, string>) => {
    const response = await fetch(url, {
      method,
      headers: { "User-Agent": userAgent, ...headers },
      redirect: "follow",
      signal: AbortSignal.timeout(BRANDING_ASSET_TIMEOUT_MS),
    });
    return response;
  };

  try {
    let response = await request("HEAD");

    if (response.status === 405 || response.status === 501) {
      response = await request("GET", { Range: "bytes=0-0" });
    }

    if (!response.ok) return false;

    return isImageContentType(response.headers.get("content-type") ?? "");
  } catch {
    return false;
  }
}

async function validateBrandingAsset(
  url: string | undefined,
  userAgent: string,
): Promise<string | undefined> {
  if (!url) return undefined;
  return (await isReachableBrandingAsset(url, userAgent)) ? url : undefined;
}

function isSiteRootUrl(url: string): boolean {
  try {
    const pathname = new URL(url).pathname.replace(/\/+$/, "") || "/";
    return pathname === "/";
  } catch {
    return false;
  }
}

function siteRootUrl(url: string): string {
  return new URL("/", url).href;
}

function apexOriginUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    const domain = registrableDomain(hostname);
    const hostWithoutWww = hostname.replace(/^www\./i, "");

    if (hostWithoutWww === domain) return undefined;

    return `${parsed.protocol}//${domain}/`;
  } catch {
    return undefined;
  }
}

function brandingFallbackUrls(startUrl: string): string[] {
  const urls: string[] = [];
  const seenOrigins = new Set<string>();

  const add = (candidate: string | undefined) => {
    if (!candidate) return;
    try {
      const origin = new URL(candidate).origin;
      if (seenOrigins.has(origin)) return;
      seenOrigins.add(origin);
      urls.push(new URL("/", candidate).href);
    } catch {
      // ignore invalid URLs
    }
  };

  if (!isSiteRootUrl(startUrl)) {
    add(siteRootUrl(startUrl));
  }

  add(apexOriginUrl(startUrl));

  return urls;
}

function extractOgSiteName($: CheerioAPI): string | undefined {
  const ogSiteName = $('meta[property="og:site_name"]').attr("content")?.trim();
  if (ogSiteName) return ogSiteName;

  const ogTitle = $('meta[property="og:title"]').attr("content")?.trim();
  const documentTitle = $("title").first().text().trim();
  const cleaned = cleanTitleForSourceName(ogTitle || documentTitle);
  if (!cleaned || looksLikeDocPageTitle(cleaned)) return undefined;

  return cleaned;
}

async function fetchOgSiteName(
  pageUrl: string,
  userAgent: string,
): Promise<string | undefined> {
  try {
    const { html, contentType } = await fetchPageHtml(pageUrl, userAgent);
    if (isPdfContentType(contentType)) return undefined;
    return extractOgSiteName(cheerio.load(html));
  } catch {
    return undefined;
  }
}

async function fetchPageBranding(
  pageUrl: string,
  userAgent: string,
): Promise<{ ogImage?: string; faviconUrl?: string }> {
  try {
    const { html, contentType } = await fetchPageHtml(pageUrl, userAgent);
    if (isPdfContentType(contentType)) return {};

    const $ = cheerio.load(html);
    const favicon = extractFaviconUrl($, pageUrl);
    const [ogImage, faviconUrl] = await Promise.all([
      validateBrandingAsset(extractOgImage($, pageUrl), userAgent),
      validateBrandingAsset(favicon.url, userAgent),
    ]);
    return { ogImage, faviconUrl };
  } catch {
    return {};
  }
}

async function fetchBrandingFallbacks(
  startUrl: string,
  userAgent: string,
  needs: { ogImage: boolean; favicon: boolean },
): Promise<{ ogImage?: string; faviconUrl?: string }> {
  let ogImage: string | undefined;
  let faviconUrl: string | undefined;

  for (const fallbackUrl of brandingFallbackUrls(startUrl)) {
    const branding = await fetchPageBranding(fallbackUrl, userAgent);
    if (needs.ogImage && !ogImage && branding.ogImage) {
      ogImage = branding.ogImage;
    }
    if (needs.favicon && !faviconUrl && branding.faviconUrl) {
      faviconUrl = branding.faviconUrl;
    }
    if ((!needs.ogImage || ogImage) && (!needs.favicon || faviconUrl)) {
      break;
    }
  }

  return { ogImage, faviconUrl };
}

export async function preflightStartUrl(
  url: string,
  userAgent = DEFAULT_CRAWL_USER_AGENT,
  customSitemapUrls: string[] = [],
): Promise<PreflightResult> {
  // Fast path: reject obvious PDF start URLs before fetching HTML/metadata.
  assertHtmlStartUrl(url);

  const [{ html, status, contentType }, discovery] = await Promise.all([
    fetchPageHtml(url, userAgent),
    probeDiscoverySignals(url, userAgent, customSitemapUrls),
  ]);

  // Catch extension-less PDF endpoints via Content-Type (e.g. /download?id=…).
  if (isPdfContentType(contentType)) {
    throw new UnsupportedStartUrlError(UNSUPPORTED_PDF_START_URL_MESSAGE);
  }

  const $ = cheerio.load(html);

  const ogSiteName = extractOgSiteName($);
  const ogTitle = $('meta[property="og:title"]').attr("content")?.trim();
  const documentTitle = $("title").first().text().trim();
  const pageTitle = cleanTitleForSourceName(ogTitle || documentTitle);
  const domainName = siteNameFromUrl(url);
  const siteSlug = siteSlugFromUrl(url);

  let siteName = ogSiteName;

  if (!siteName && !isSiteRootUrl(url)) {
    for (const fallbackUrl of brandingFallbackUrls(url)) {
      siteName = await fetchOgSiteName(fallbackUrl, userAgent);
      if (siteName) break;
    }
  }

  if (!siteName) {
    siteName = looksLikeDocPageTitle(pageTitle)
      ? domainName
      : pageTitle || domainName;
  } else if (!ogSiteName && looksLikeDocPageTitle(siteName)) {
    siteName = domainName;
  }

  if (!siteName) {
    siteName = hostnameLabel(url);
  }

  let ogImage = extractOgImage($, url);

  const favicon = extractFaviconUrl($, url);
  let faviconUrl = favicon.url;

  [ogImage, faviconUrl] = await Promise.all([
    validateBrandingAsset(ogImage, userAgent),
    validateBrandingAsset(faviconUrl, userAgent),
  ]);

  if (!ogImage || !faviconUrl) {
    const fallbackBranding = await fetchBrandingFallbacks(url, userAgent, {
      ogImage: !ogImage,
      favicon: !faviconUrl,
    });
    if (!ogImage && fallbackBranding.ogImage) {
      ogImage = fallbackBranding.ogImage;
    }
    if (!faviconUrl && fallbackBranding.faviconUrl) {
      faviconUrl = fallbackBranding.faviconUrl;
    }
  }

  const metadata = await classifySource({
    url,
    html,
    $,
    userAgent,
  });

  return {
    url,
    ok: status >= 200 && status < 400,
    status,
    siteName,
    siteSlug,
    title: documentTitle || ogTitle || undefined,
    ogImage,
    faviconUrl,
    discovery,
    metadata,
  };
}
