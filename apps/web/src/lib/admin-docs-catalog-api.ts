import type { DocsPathEntry, TypescriptDocsCatalogEntry } from "@/lib/typescript-docs-catalog";

const ENDPOINT = "/api/admin/typescript-docs-catalog";
const PREVIEW_ENDPOINT = "/api/admin/typescript-docs-catalog/preview-crawl";

export type CatalogPathDraft = DocsPathEntry & {
  confidence?: number;
};

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

async function parseJson(response: Response) {
  const data = (await response.json().catch(() => ({}))) as {
    error?: string;
    ok?: boolean;
    entry?: TypescriptDocsCatalogEntry;
    catalogCount?: number;
  };
  if (!response.ok) {
    throw new Error(data.error || `Request failed (${response.status})`);
  }
  return data;
}

export async function previewCatalogPathCrawl(input: {
  url: string;
  excludePatterns?: string[];
  patternsAreRegex?: boolean;
  maxUrls?: number;
}): Promise<PathPreviewCrawlResult> {
  const response = await fetch(PREVIEW_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: input.url,
      excludePatterns: input.excludePatterns,
      patternsAreRegex: input.patternsAreRegex,
      maxUrls: input.maxUrls,
    }),
  });
  const data = (await response.json().catch(() => ({}))) as PathPreviewCrawlResult & {
    error?: string;
    ok?: boolean;
  };
  if (!response.ok) {
    throw new Error(data.error || `Preview failed (${response.status})`);
  }
  return data;
}

export async function previewCatalogPathOverlaps(input: {
  urls: string[];
  excludePatterns?: string[];
  patternsAreRegex?: boolean;
  maxUrls?: number;
}): Promise<PathOverlapReport> {
  const response = await fetch(PREVIEW_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      mode: "overlaps",
      urls: input.urls,
      excludePatterns: input.excludePatterns,
      patternsAreRegex: input.patternsAreRegex,
      maxUrls: input.maxUrls,
    }),
  });
  const data = (await response.json().catch(() => ({}))) as PathOverlapReport & {
    error?: string;
    ok?: boolean;
  };
  if (!response.ok) {
    throw new Error(data.error || `Overlap check failed (${response.status})`);
  }
  return data;
}

export async function saveCatalogPackagePaths(input: {
  packageName: string;
  paths: CatalogPathDraft[];
  approve?: boolean;
  pathsReason?: string;
}): Promise<TypescriptDocsCatalogEntry> {
  const response = await fetch(ENDPOINT, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "patch-paths",
      packageName: input.packageName,
      paths: input.paths,
      approve: input.approve ?? false,
      pathsReason: input.pathsReason,
    }),
  });
  const data = await parseJson(response);
  if (!data.entry) throw new Error("Save succeeded but no entry returned");
  return data.entry;
}

export async function upsertCatalogPackage(input: {
  packageName: string;
  docsUrl: string;
  category?: string;
  pathUrl?: string;
  pathLabel?: string;
}): Promise<TypescriptDocsCatalogEntry> {
  const response = await fetch(ENDPOINT, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "upsert-package",
      packageName: input.packageName,
      docsUrl: input.docsUrl,
      category: input.category,
      pathUrl: input.pathUrl,
      pathLabel: input.pathLabel,
    }),
  });
  const data = await parseJson(response);
  if (!data.entry) throw new Error("Upsert succeeded but no entry returned");
  return data.entry;
}

export function pathsEqual(
  a: CatalogPathDraft[],
  b: CatalogPathDraft[],
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const left = a[i]!;
    const right = b[i]!;
    if (left.url !== right.url) return false;
    if ((left.kind || "other") !== (right.kind || "other")) return false;
    if ((left.label || "") !== (right.label || "")) return false;
  }
  return true;
}
