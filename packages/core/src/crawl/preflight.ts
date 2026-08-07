import * as cheerio from "cheerio";
import type { CheerioAPI } from "cheerio";
import {
  probeDiscoverySignals,
  type DiscoverySignals,
} from "./discovery-probes.js";
import { classifySource } from "./classify-source.js";
import { fetchPageHtml } from "../extract/parser/extract-content.js";
import type { SourceMetadata } from "../schemas/source-metadata.js";

const BOT_USER_AGENT = "LedgeIndexBot/1.0 (+https://ledgeindex.ai)";

export type PreflightResult = {
  url: string;
  ok: boolean;
  status: number;
  siteName: string;
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

function hostnameLabel(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return "Web source";
  }
}

function parseIconSize(sizes: string | undefined): number {
  if (!sizes?.trim()) return 0;
  const match = sizes.match(/(\d+)\s*x\s*(\d+)/i);
  if (!match) return 0;
  return Math.max(Number(match[1]), Number(match[2])) || 0;
}

function extractFaviconUrl($: CheerioAPI, pageUrl: string): string | undefined {
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
    return candidates[0]!.url;
  }

  return resolveAbsoluteUrl(pageUrl, "/favicon.ico");
}

export async function preflightStartUrl(
  url: string,
  userAgent = BOT_USER_AGENT,
  customSitemapUrls: string[] = [],
): Promise<PreflightResult> {
  const [{ html, status }, discovery] = await Promise.all([
    fetchPageHtml(url, userAgent),
    probeDiscoverySignals(url, userAgent, customSitemapUrls),
  ]);

  const $ = cheerio.load(html);

  const ogSiteName = $('meta[property="og:site_name"]').attr("content")?.trim();
  const ogTitle = $('meta[property="og:title"]').attr("content")?.trim();
  const documentTitle = $("title").first().text().trim();

  const siteName =
    ogSiteName ||
    cleanTitleForSourceName(ogTitle || documentTitle) ||
    hostnameLabel(url);

  const ogImage =
    resolveAbsoluteUrl(url, $('meta[property="og:image"]').attr("content")) ||
    resolveAbsoluteUrl(url, $('meta[name="twitter:image"]').attr("content")) ||
    resolveAbsoluteUrl(url, $('meta[name="twitter:image:src"]').attr("content"));

  const faviconUrl = extractFaviconUrl($, url);

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
    title: documentTitle || ogTitle || undefined,
    ogImage,
    faviconUrl,
    discovery,
    metadata,
  };
}
