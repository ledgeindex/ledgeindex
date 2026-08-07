import type { CheerioAPI } from "cheerio";

const GENERIC_TITLE_PATTERN =
  /^(docs?|documentation|home|overview|untitled|page)$/i;

export function isWeakPageTitle(title: string): boolean {
  const trimmed = title.trim();
  if (trimmed.length < 3) return true;
  if (GENERIC_TITLE_PATTERN.test(trimmed)) return true;
  if (/^https?:\/\//i.test(trimmed)) return true;
  return false;
}

export function extractMetaTitle($: CheerioAPI): string {
  const og =
    $('meta[property="og:title"]').attr("content") ??
    $('meta[name="og:title"]').attr("content") ??
    $('meta[name="twitter:title"]').attr("content");
  return og?.trim() ?? "";
}

export function extractHtmlHeadingTitle($: CheerioAPI): string {
  return $("h1").first().text().replace(/\s+/g, " ").trim();
}

export function extractFirstMarkdownHeading(markdown: string): string {
  for (const line of markdown.split("\n")) {
    const match = /^(#{1,2})\s+(.+)$/.exec(line.trim());
    if (!match) continue;
    const title = match[2]
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/\s+/g, " ")
      .trim();
    if (title && !isWeakPageTitle(title)) return title;
  }
  return "";
}

/** Humanize last URL path segment: workspace/overview → Workspace Overview */
export function titleFromUrlSlug(url: string): string {
  try {
    const parts = new URL(url).pathname.split("/").filter(Boolean);
    const slug = parts.at(-1) ?? "";
    if (!slug) return "";

    return slug
      .replace(/\.[a-z0-9]+$/i, "")
      .split(/[-_]+/)
      .filter(Boolean)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(" ");
  } catch {
    return "";
  }
}

export function resolvePageTitle(input: {
  url: string;
  htmlTitle?: string;
  metaTitle?: string;
  readabilityTitle?: string;
  htmlHeading?: string;
  markdownHeading?: string;
}): string {
  const candidates = [
    input.htmlTitle?.trim(),
    input.metaTitle?.trim(),
    input.readabilityTitle?.trim(),
    input.htmlHeading?.trim(),
    input.markdownHeading?.trim(),
    titleFromUrlSlug(input.url),
  ].filter((value): value is string => Boolean(value));

  const strong = candidates.find((title) => !isWeakPageTitle(title));
  if (strong) return strong;

  const weak = candidates[0];
  if (weak) return weak;

  return input.url;
}

const GENERIC_PATH_SEGMENTS = new Set([
  "docs",
  "doc",
  "documentation",
  "en",
  "api",
  "www",
  "v1",
  "v2",
]);

/**
 * Path segments as plain keywords for rewrite catalog hints.
 * /docs/agents/a2a → "agents a2a" (no slashes, no "docs").
 */
export function pathKeywordsFromUrl(url: string): string {
  try {
    const segments = new URL(url).pathname
      .split("/")
      .filter(Boolean)
      .map((segment) =>
        segment
          .replace(/\.[a-z0-9]+$/i, "")
          .replace(/[-_]+/g, " ")
          .trim()
          .toLowerCase(),
      )
      .filter(
        (segment) =>
          segment.length >= 2 && !GENERIC_PATH_SEGMENTS.has(segment),
      );

    return [...new Set(segments)].join(" ");
  } catch {
    return "";
  }
}

/** Catalog line for query rewrite — title plus optional keyword hints, never a URL path. */
export function formatCatalogPageForRewrite(input: {
  title: string;
  url: string;
}): string {
  const title = input.title.trim() || "Untitled";
  const keywords = pathKeywordsFromUrl(input.url);
  if (!keywords) return `- ${title}`;

  const titleLower = title.toLowerCase();
  const extraKeywords = keywords
    .split(" ")
    .filter((word) => word.length >= 2 && !titleLower.includes(word));

  if (extraKeywords.length === 0) {
    return `- ${title}`;
  }

  return `- ${title}\n  keywords: ${keywords}`;
}

export function pagePlannerLabel(input: {
  title: string;
  url: string;
}): string {
  let path = input.url;
  try {
    path = new URL(input.url).pathname.replace(/\/+$/, "") || "/";
  } catch {
    // keep full url
  }
  return `${input.title}  [${path}]`;
}
