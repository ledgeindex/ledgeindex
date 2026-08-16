import type { SourceMetadata } from "../schemas/source-metadata.js";

export type ChunkMetadataFields = {
  text: string;
  url: string;
  title: string;
  sourceId: string;
  projectId: string;
  category: string;
  section: string;
  headingPath: string[];
  contentType: string;
  language: string;
  chunkIndex: number;
  sourceType: string;
  origin: string;
  version: string | null;
  versionLabel: string | null;
  versionNumber: number | null;
  sourceFamilyId: string | null;
  /** Crawl root start URL this page was ingested under (multi-path sources). */
  crawlRoot: string | null;
};

export function deriveUrlSegments(url: string): {
  category: string;
  section: string;
} {
  try {
    const pathname = new URL(url).pathname.replace(/\/+$/, "");
    const parts = pathname.split("/").filter(Boolean);
    return {
      category: parts[0] ?? "root",
      section: parts[1] ?? parts[0] ?? "general",
    };
  } catch {
    return { category: "root", section: "general" };
  }
}

function normalizePathRoot(url: string): string {
  try {
    const parsed = new URL(url.trim());
    parsed.hash = "";
    parsed.search = "";
    const pathname = parsed.pathname.replace(/\/+$/, "") || "/";
    parsed.pathname = pathname;
    return parsed.toString().replace(/\/$/, pathname === "/" ? "/" : "");
  } catch {
    return url.trim().replace(/\/+$/, "");
  }
}

function urlBelongsToPathRoot(pageUrl: string, pathStartUrl: string): boolean {
  const root = normalizePathRoot(pathStartUrl);
  if (!root) return false;
  try {
    const page = new URL(pageUrl);
    const base = new URL(root);
    const pageHost = page.hostname.replace(/^www\./i, "").toLowerCase();
    const baseHost = base.hostname.replace(/^www\./i, "").toLowerCase();
    if (pageHost !== baseHost) return false;
    const pagePath = page.pathname.replace(/\/+$/, "") || "/";
    const rootPath = base.pathname.replace(/\/+$/, "") || "/";
    if (rootPath === "/") return true;
    return pagePath === rootPath || pagePath.startsWith(`${rootPath}/`);
  } catch {
    return pageUrl.startsWith(root);
  }
}

/** Longest-prefix crawl root for a page URL (multi-path sources). */
export function matchCrawlRootForUrl(
  pageUrl: string,
  crawlRoots: readonly string[] | null | undefined,
): string | null {
  if (!crawlRoots?.length) return null;
  let best: string | null = null;
  let bestLen = -1;
  for (const raw of crawlRoots) {
    const root = normalizePathRoot(raw);
    if (!root || !urlBelongsToPathRoot(pageUrl, root)) continue;
    try {
      const len = new URL(root).pathname.replace(/\/+$/, "").length;
      if (len > bestLen) {
        best = root;
        bestLen = len;
      }
    } catch {
      if (root.length > bestLen) {
        best = root;
        bestLen = root.length;
      }
    }
  }
  return best;
}

export function extractHeadingPath(markdown: string): string[] {
  const headings: string[] = [];
  for (const line of markdown.split("\n")) {
    const match = /^(#{1,6})\s+(.+)$/.exec(line.trim());
    if (!match) continue;
    const level = match[1].length;
    const title = match[2].trim();
    headings.length = level - 1;
    headings[level - 1] = title;
  }
  return headings.filter(Boolean);
}

export function buildChunkMetadata(input: {
  text: string;
  url: string;
  title: string;
  sourceId: string;
  projectId: string;
  chunkIndex: number;
  contentType?: string;
  language?: string;
  sourceMetadata?: SourceMetadata | null;
  versionLabel?: string | null;
  versionNumber?: number | null;
  sourceFamilyId?: string | null;
  crawlRoot?: string | null;
  /** Explicit facets; win over URL-derived segments and headings when set. */
  category?: string | null;
  section?: string | null;
  /**
   * Path within a repository checkout, for sources that are a checkout rather
   * than a crawl. Set on every page of such a source, not only the ones the AST
   * chunker handled: it is what identifies a source as code at query time, and a
   * repo's own `.mdx` pages are part of that source.
   */
  filePath?: string | null;
}): ChunkMetadataFields {
  const derived = deriveUrlSegments(input.url);
  const headingPath = extractHeadingPath(input.text);
  const category = input.category?.trim() || derived.category;
  const section =
    input.section?.trim() || headingPath[0] || derived.section;
  const sourceType = input.sourceMetadata?.sourceType ?? "unknown";
  const origin = input.sourceMetadata?.origin ?? "external";
  const versionLabel =
    input.versionLabel ??
    input.sourceMetadata?.version ??
    null;
  const version = versionLabel;

  return {
    text: input.text,
    url: input.url,
    title: input.title,
    sourceId: input.sourceId,
    projectId: input.projectId,
    category,
    section,
    headingPath,
    contentType: input.contentType ?? "html",
    language: input.language ?? "en",
    chunkIndex: input.chunkIndex,
    sourceType,
    origin,
    version,
    versionLabel,
    versionNumber: input.versionNumber ?? null,
    sourceFamilyId: input.sourceFamilyId ?? null,
    crawlRoot: input.crawlRoot?.trim() || null,
    ...(input.filePath?.trim() ? { filePath: input.filePath.trim() } : {}),
  };
}
