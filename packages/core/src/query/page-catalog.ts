import type {
  MetadataCatalog,
  MetadataCatalogPage,
} from "./metadata-catalog.js";

export function buildPageCatalogFromMetadata(
  metadata: Record<string, unknown>[],
): MetadataCatalogPage[] {
  const byUrl = new Map<
    string,
    { title: string; chunkCount: number; category?: string; crawlRoot?: string | null }
  >();

  for (const item of metadata) {
    const url = String(item.url ?? "").trim();
    if (!url) continue;

    const title = String(item.title ?? "").trim() || url;
    const category =
      typeof item.category === "string" && item.category.trim()
        ? item.category.trim()
        : undefined;
    const crawlRoot =
      typeof item.crawlRoot === "string" && item.crawlRoot.trim()
        ? item.crawlRoot.trim()
        : null;
    const existing = byUrl.get(url);
    if (existing) {
      existing.chunkCount += 1;
      if (title.length > existing.title.length) {
        existing.title = title;
      }
      if (!existing.category && category) existing.category = category;
      if (!existing.crawlRoot && crawlRoot) existing.crawlRoot = crawlRoot;
    } else {
      byUrl.set(url, { title, chunkCount: 1, category, crawlRoot });
    }
  }

  return [...byUrl.entries()]
    .map(([url, data]) => ({
      url,
      title: data.title,
      chunkCount: data.chunkCount,
      ...(data.category ? { category: data.category } : {}),
      ...(data.crawlRoot ? { crawlRoot: data.crawlRoot } : {}),
    }))
    .sort((a, b) => a.title.localeCompare(b.title));
}

export function buildMetadataCatalog(
  sourceId: string,
  metadata: Record<string, unknown>[],
): MetadataCatalog {
  const byCategory = new Map<
    string,
    { sections: Map<string, number>; pageUrls: Set<string>; chunkCount: number }
  >();

  for (const item of metadata) {
    const category = String(item.category ?? "root");
    const section = String(item.section ?? "general");
    const url = String(item.url ?? "");

    if (!byCategory.has(category)) {
      byCategory.set(category, {
        sections: new Map(),
        pageUrls: new Set(),
        chunkCount: 0,
      });
    }

    const entry = byCategory.get(category)!;
    entry.chunkCount += 1;
    if (url) entry.pageUrls.add(url);
    entry.sections.set(section, (entry.sections.get(section) ?? 0) + 1);
  }

  const categories = [...byCategory.entries()].map(([name, data]) => ({
    name,
    chunkCount: data.chunkCount,
    pageCount: data.pageUrls.size,
    sections: [...data.sections.entries()].map(([sectionName, chunkCount]) => ({
      name: sectionName,
      chunkCount,
    })),
  }));

  return {
    sourceId,
    categories,
    pages: buildPageCatalogFromMetadata(metadata),
    updatedAt: new Date().toISOString(),
  };
}

export function pageCatalogPathLabel(url: string): string {
  try {
    const pathname = new URL(url).pathname.replace(/\/+$/, "") || "/";
    return pathname;
  } catch {
    return url;
  }
}
