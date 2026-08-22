import type { CheerioAPI } from "cheerio";
import { normalizeStartUrl } from "../lib/url.js";

export type HeaderNavPath = {
  url: string;
  label: string;
};

/** Primary start URL plus unique sibling section roots (guides, reference, …). */
export function mergeHeaderNavStartUrls(
  primaryUrl: string,
  siblingUrls: string[],
): string[] {
  const primary = normalizeStartUrl(primaryUrl.trim());
  if (!primary) return [];
  const out = [primary];
  const seen = new Set<string>([primary]);
  for (const raw of siblingUrls) {
    const url = normalizeStartUrl(raw.trim());
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push(url);
  }
  return out;
}

const SECTION_NAMES = new Set([
  "api",
  "apis",
  "changelog",
  "doc",
  "docs",
  "documentation",
  "example",
  "examples",
  "guide",
  "guides",
  "handbook",
  "learn",
  "reference",
  "releases",
  "sdk",
  "sdks",
  "spec",
  "specification",
  "tutorial",
  "tutorials",
]);

const SKIP_SEGMENTS = new Set([
  "about",
  "blog",
  "careers",
  "community",
  "contact",
  "discord",
  "github",
  "legal",
  "login",
  "news",
  "pricing",
  "privacy",
  "signin",
  "signup",
  "terms",
  "twitter",
]);

function normalizePath(pathname: string): string {
  const trimmed = pathname.replace(/\/+$/, "") || "/";
  return trimmed;
}

function labelFromPath(pathname: string, hostname: string): string {
  const parts = pathname.split("/").filter(Boolean);
  const last = parts[parts.length - 1];
  if (!last) {
    return hostname.replace(/^www\./, "") || "Site";
  }
  return last
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function isDocsSectionPath(pathname: string): boolean {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length === 0 || parts.length > 2) return false;
  if (parts.some((part) => SKIP_SEGMENTS.has(part.toLowerCase()))) return false;
  return parts.some((part) => SECTION_NAMES.has(part.toLowerCase()));
}

function isSidebarOrFooter(classAndLabel: string): boolean {
  return /sidebar|toc|breadcrumb|footer|menu-mobile/i.test(classAndLabel);
}

/**
 * Sibling docs section roots from the site header / primary nav
 * (`/guides`, `/reference`, …) — not sidebar chapter links.
 */
export function extractHeaderNavPaths(
  pageUrl: string,
  $: CheerioAPI,
): HeaderNavPath[] {
  let origin: string;
  let hostname: string;
  let currentPath: string;
  try {
    const parsed = new URL(pageUrl);
    origin = parsed.origin;
    hostname = parsed.hostname;
    currentPath = normalizePath(parsed.pathname);
  } catch {
    return [];
  }

  const $banner = $("header, [role='banner']").first();
  const $navs = $("nav").filter((_, el) => {
    const cls = `${$(el).attr("class") ?? ""} ${$(el).attr("aria-label") ?? ""}`;
    return !isSidebarOrFooter(cls);
  });
  const $scope = $banner.length ? $banner : $navs.first();
  if (!$scope.length) return [];

  const seen = new Set<string>([currentPath]);
  const paths: HeaderNavPath[] = [];

  $scope.find("a[href]").each((_, el) => {
    if (paths.length >= 8) return;
    const href = ($(el).attr("href") ?? "").trim();
    if (!href || href.startsWith("#") || href.startsWith("javascript:")) return;

    const parentCls = `${$(el).closest("nav, aside, footer, [class*='sidebar']").attr("class") ?? ""} ${$(el).closest("nav").attr("aria-label") ?? ""}`;
    if (isSidebarOrFooter(parentCls)) return;

    let next: URL;
    try {
      next = new URL(href, pageUrl);
    } catch {
      return;
    }
    if (next.origin !== origin) return;

    const pathname = normalizePath(next.pathname);
    if (!isDocsSectionPath(pathname)) return;
    if (seen.has(pathname)) return;
    if (currentPath !== "/" && pathname.startsWith(`${currentPath}/`)) return;

    seen.add(pathname);
    const url = `${origin}${pathname === "/" ? "" : pathname}`;
    paths.push({
      url,
      label: labelFromPath(pathname, hostname),
    });
  });

  return paths;
}
