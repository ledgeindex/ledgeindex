import { extractFirstMarkdownHeading } from "./page-title.js";

export type NativeMarkdownResult = {
  url: string;
  title: string;
  markdown: string;
};

function stripHash(url: string): string {
  return url.split("#")[0] ?? url;
}

/** Many doc platforms (Mintlify, etc.) expose `{page-url}.md` with native markdown. */
export function buildMarkdownAlternateUrls(pageUrl: string): string[] {
  const base = stripHash(pageUrl);
  if (base.endsWith(".md")) return [];

  const candidates = new Set<string>();
  candidates.add(`${base}.md`);
  if (base.endsWith("/")) {
    candidates.add(`${base.slice(0, -1)}.md`);
  }

  return [...candidates];
}

function normalizeContentType(contentType: unknown): string {
  if (typeof contentType === "string") return contentType;
  if (
    contentType &&
    typeof contentType === "object" &&
    "type" in contentType &&
    typeof (contentType as { type: unknown }).type === "string"
  ) {
    return (contentType as { type: string }).type;
  }
  return "";
}

export function isMarkdownResponse(contentType: unknown, body: string): boolean {
  const type = normalizeContentType(contentType).toLowerCase();
  if (type.includes("text/markdown")) return true;
  if (!type.includes("text/html")) {
    const trimmed = body.trimStart();
    return trimmed.startsWith("#") || trimmed.startsWith(">");
  }
  return false;
}

export async function tryFetchNativeMarkdown(
  pageUrl: string,
  userAgent: string,
): Promise<NativeMarkdownResult | null> {
  for (const markdownUrl of buildMarkdownAlternateUrls(pageUrl)) {
    try {
      const response = await fetch(markdownUrl, {
        headers: {
          "User-Agent": userAgent,
          Accept: "text/markdown,text/plain,*/*",
        },
        signal: AbortSignal.timeout(30_000),
      });

      if (!response.ok) continue;

      const body = await response.text();
      const contentType = response.headers.get("content-type") ?? "";
      if (!isMarkdownResponse(contentType, body)) continue;

      const markdown = body.trim();
      if (!markdown) continue;

      return {
        url: pageUrl,
        title: extractFirstMarkdownHeading(markdown) || pageUrl,
        markdown,
      };
    } catch {
      continue;
    }
  }

  return null;
}

/** Pull same-host links from markdown for crawl discovery. */
export function extractMarkdownLinks(markdown: string, baseUrl: string): string[] {
  const urls = new Set<string>();
  let origin: string;
  try {
    origin = new URL(baseUrl).origin;
  } catch {
    return [];
  }

  for (const match of markdown.matchAll(/\[([^\]]*)\]\(([^)]+)\)/g)) {
    const href = match[2]?.trim();
    if (!href || href.startsWith("#")) continue;
    try {
      const absolute = new URL(href, baseUrl).href;
      if (new URL(absolute).origin === origin) {
        urls.add(absolute.split("#")[0]!);
      }
    } catch {
      // ignore invalid URLs in markdown
    }
  }

  for (const match of markdown.matchAll(/https?:\/\/[^\s)<>"']+/g)) {
    try {
      const absolute = new URL(match[0]).href.split("#")[0]!;
      if (new URL(absolute).origin === origin) {
        urls.add(absolute);
      }
    } catch {
      // ignore invalid URLs in markdown
    }
  }

  return [...urls];
}
