import type { MetadataCatalog } from "./metadata-catalog.js";
import { formatCatalogPageForRewrite } from "../parser/page-title.js";

function normalizePathPrefix(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return "";
  try {
    const parsed = new URL(trimmed);
    parsed.hash = "";
    parsed.search = "";
    parsed.pathname = parsed.pathname.replace(/\/+$/, "") || "/";
    return parsed.toString().replace(/\/$/, parsed.pathname === "/" ? "/" : "");
  } catch {
    return trimmed.replace(/\/+$/, "");
  }
}

function urlMatchesPathPrefix(pageUrl: string, pathStartUrl: string): boolean {
  const root = normalizePathPrefix(pathStartUrl);
  if (!root) return true;
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

/**
 * Narrow a source catalog to pages under a docs path root.
 * Used so query rewrite / catalog URL hints match Path scope (Docs vs Guides).
 */
export function filterCatalogByUrlPrefix(
  catalog: MetadataCatalog | null,
  urlPrefix: string | null | undefined,
): MetadataCatalog | null {
  if (!catalog) return null;
  const prefix = urlPrefix?.trim();
  if (!prefix) return catalog;

  const pages = catalog.pages.filter((page) =>
    urlMatchesPathPrefix(page.url, prefix),
  );
  if (pages.length === catalog.pages.length) return catalog;

  return {
    ...catalog,
    pages,
    // Categories are coarse; drop them when path-scoped so rewrite uses pages only.
    categories: [],
  };
}

/** Full page catalog for the docs agent — titles + keyword hints, no URLs. */
export function formatCatalogForAgent(
  catalog: MetadataCatalog | null,
): string {
  if (catalog?.pages?.length) {
    return catalog.pages
      .map((page) => formatCatalogPageForRewrite(page))
      .join("\n");
  }

  if (!catalog?.categories.length) {
    return "No catalog available.";
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
