export type SourcePathOption = {
  id: string;
  label: string;
  startUrl: string;
};

/** Normalize a docs start URL for identity / prefix matching. */
export function normalizeSourcePathStartUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return "";
  try {
    const parsed = new URL(trimmed);
    parsed.hash = "";
    parsed.search = "";
    const pathname = parsed.pathname.replace(/\/+$/, "") || "/";
    parsed.pathname = pathname;
    return parsed.toString().replace(/\/$/, pathname === "/" ? "/" : "");
  } catch {
    return trimmed.replace(/\/+$/, "");
  }
}

/** Human label from a path root URL (`/docs` → Docs, `/reference` → Reference). */
export function labelFromSourcePathUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname.replace(/\/+$/, "");
    const parts = pathname.split("/").filter(Boolean);
    const last = parts[parts.length - 1];
    if (!last) {
      const host = new URL(url).hostname.replace(/^www\./, "");
      return host || "Site";
    }
    return last
      .split(/[-_]/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
      .join(" ");
  } catch {
    return "Path";
  }
}

export function sourcePathIdFromStartUrl(startUrl: string): string {
  const normalized = normalizeSourcePathStartUrl(startUrl);
  let hash = 0;
  for (let i = 0; i < normalized.length; i++) {
    hash = (hash * 31 + normalized.charCodeAt(i)) >>> 0;
  }
  return `path_${hash.toString(36)}`;
}

export function pathOptionsFromStartUrls(
  startUrls: readonly string[],
): SourcePathOption[] {
  const seen = new Set<string>();
  const options: SourcePathOption[] = [];

  for (const raw of startUrls) {
    const startUrl = normalizeSourcePathStartUrl(raw) || raw.trim();
    if (!startUrl) continue;
    const id = sourcePathIdFromStartUrl(startUrl);
    if (seen.has(id)) continue;
    seen.add(id);
    options.push({
      id,
      label: labelFromSourcePathUrl(startUrl),
      startUrl,
    });
  }

  return options;
}

/** Whether a page URL belongs under a crawl path root. */
export function urlBelongsToSourcePath(
  pageUrl: string,
  pathStartUrl: string,
): boolean {
  const root = normalizeSourcePathStartUrl(pathStartUrl);
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

/**
 * Longest-prefix match: which crawl root a page URL belongs to.
 * Prefer more specific roots (`/docs/guides` over `/docs`).
 */
export function matchSourcePathRoot(
  pageUrl: string,
  pathStartUrls: readonly string[],
): string | null {
  const roots = pathStartUrls
    .map((url) => normalizeSourcePathStartUrl(url) || url.trim())
    .filter(Boolean);
  if (roots.length === 0) return null;

  let best: string | null = null;
  let bestLen = -1;
  for (const root of roots) {
    if (!urlBelongsToSourcePath(pageUrl, root)) continue;
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

export function sourcePathLabelForUrl(
  pageUrl: string,
  pathStartUrls: readonly string[],
): string | null {
  const root = matchSourcePathRoot(pageUrl, pathStartUrls);
  return root ? labelFromSourcePathUrl(root) : null;
}

/** Fallback scan tag from the first path segment when roots are unavailable. */
export function pathSegmentLabelForUrl(pageUrl: string): string {
  try {
    const parts = new URL(pageUrl).pathname.split("/").filter(Boolean);
    const segment = parts[0];
    if (!segment) {
      return new URL(pageUrl).hostname.replace(/^www\./, "") || "Site";
    }
    return segment
      .split(/[-_]/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
      .join(" ");
  } catch {
    return "Path";
  }
}
