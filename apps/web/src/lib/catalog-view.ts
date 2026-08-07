import type { MetadataCatalog, MetadataCatalogPage } from "@/lib/ledgeindex-api";

export function pageCatalogPathLabel(url: string): string {
  try {
    const pathname = new URL(url).pathname.replace(/\/+$/, "") || "/";
    return pathname;
  } catch {
    return url;
  }
}

export function filterCatalogPages(
  pages: MetadataCatalogPage[],
  filter: string,
): MetadataCatalogPage[] {
  const normalized = filter.trim().toLowerCase();
  if (!normalized) return pages;

  return pages.filter(
    (page) =>
      page.title.toLowerCase().includes(normalized) ||
      page.url.toLowerCase().includes(normalized) ||
      pageCatalogPathLabel(page.url).toLowerCase().includes(normalized),
  );
}

export function formatAgentCatalogHint(catalog: MetadataCatalog | null): string {
  if (!catalog) return "No catalog available for this set.";
  if (catalog.pages?.length) {
    const sample = catalog.pages
      .slice(0, 8)
      .map((page) => page.title)
      .join("; ");
    const more =
      catalog.pages.length > 8
        ? ` (+${catalog.pages.length - 8} more pages)`
        : "";
    return `${catalog.pages.length} indexed pages, e.g. ${sample}${more}`;
  }
  if (!catalog.categories.length) return "No catalog available for this set.";
  const topics = catalog.categories.map((category) => category.name).join(", ");
  return `Indexed topics: ${topics}`;
}

export function formatPlannerCatalogPreview(
  catalog: MetadataCatalog | null,
): string {
  if (!catalog) return "No catalog available.";
  if (catalog.pages?.length) {
    return catalog.pages.map((page) => `- ${page.title}`).join("\n");
  }
  if (!catalog.categories.length) {
    return "No catalog available — planner falls back to the user question.";
  }
  return catalog.categories
    .slice(0, 16)
    .map((category) => {
      const sections = category.sections
        .slice(0, 10)
        .map((section) => section.name)
        .filter(Boolean)
        .join(", ");
      return `- ${category.name}: ${sections || "(no sections)"}`;
    })
    .join("\n");
}
