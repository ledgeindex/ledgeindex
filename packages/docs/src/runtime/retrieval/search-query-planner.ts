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

/**
 * Char budget for the catalog block in the rewrite prompt. A flat catalog of a
 * few hundred doc pages fits comfortably; a repo checkout does not — Stagehand
 * produces ~85 KB of file paths, which crowds out the question itself.
 */
const CATALOG_CHAR_BUDGET = 28_000;
const CATALOG_MAX_PAGES_PER_GROUP = 60;

/**
 * Group pages under their category and cap each group. Used only when the flat
 * catalog blows the budget, so ordinary doc sources are untouched.
 */
function formatGroupedCatalog(
  pages: MetadataCatalog["pages"],
  charBudget: number,
): string {
  const groups = new Map<string, MetadataCatalog["pages"]>();
  for (const page of pages) {
    const key = page.category?.trim() || "other";
    const bucket = groups.get(key);
    if (bucket) bucket.push(page);
    else groups.set(key, [page]);
  }

  const ordered = [...groups.entries()].sort(
    (a, b) => b[1].length - a[1].length,
  );
  const lines: string[] = [];
  let used = 0;
  let shown = 0;

  for (const [name, groupPages] of ordered) {
    const sorted = [...groupPages].sort(
      (a, b) => (b.chunkCount ?? 0) - (a.chunkCount ?? 0),
    );
    const visible = sorted.slice(0, CATALOG_MAX_PAGES_PER_GROUP);
    const header = `## ${name} (${groupPages.length} pages)`;
    const body = visible
      .map((page) => `- ${page.title.trim() || "Untitled"}`)
      .join("\n");
    const hidden = groupPages.length - visible.length;
    const block =
      hidden > 0 ? `${header}\n${body}\n- …and ${hidden} more` : `${header}\n${body}`;

    if (used + block.length > charBudget) break;
    lines.push(block);
    used += block.length + 1;
    shown += visible.length;
  }

  if (lines.length === 0) return "No catalog available.";
  if (shown < pages.length) {
    lines.push(`(showing ${shown} of ${pages.length} indexed pages)`);
  }
  return lines.join("\n");
}

/** Full page catalog for the docs agent — titles + keyword hints, no URLs. */
export function formatCatalogForAgent(
  catalog: MetadataCatalog | null,
  options?: { charBudget?: number },
): string {
  const charBudget = options?.charBudget ?? CATALOG_CHAR_BUDGET;
  if (catalog?.pages?.length) {
    const flat = catalog.pages
      .map((page) => formatCatalogPageForRewrite(page))
      .join("\n");
    if (flat.length <= charBudget) return flat;
    return formatGroupedCatalog(catalog.pages, charBudget);
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
