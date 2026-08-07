export type StartUrlScope = {
  origin: string;
  pathPrefix: string;
};

function normalizePathname(pathname: string): string {
  if (!pathname || pathname === "/") return "/";
  const trimmed = pathname.replace(/\/+$/, "");
  return trimmed || "/";
}

/** Treat www.example.com and example.com as the same site for crawl scope. */
function siteHostname(hostname: string): string {
  return hostname.replace(/^www\./i, "").toLowerCase();
}

function hostnamesMatch(a: string, b: string): boolean {
  return siteHostname(a) === siteHostname(b);
}

export function getStartUrlScopes(startUrls: string[]): StartUrlScope[] {
  const scopes: StartUrlScope[] = [];
  const seen = new Set<string>();

  for (const startUrl of startUrls) {
    try {
      const parsed = new URL(startUrl);
      const origin = parsed.origin;
      const pathPrefix = normalizePathname(parsed.pathname);
      const key = `${origin}|${pathPrefix}`;
      if (seen.has(key)) continue;
      seen.add(key);
      scopes.push({ origin, pathPrefix });
    } catch {
      // ignore invalid start URLs
    }
  }

  return scopes;
}

export function isWithinStartUrlScope(
  url: string,
  scopes: StartUrlScope[],
): boolean {
  if (scopes.length === 0) return true;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  const path = normalizePathname(parsed.pathname);

  return scopes.some((scope) => {
    const scopeHost = new URL(scope.origin).hostname;
    if (!hostnamesMatch(parsed.hostname, scopeHost)) return false;
    if (scope.pathPrefix === "/") return true;
    return (
      path === scope.pathPrefix || path.startsWith(`${scope.pathPrefix}/`)
    );
  });
}

export function matchesPattern(
  value: string,
  pattern: string,
  patternsAreRegex: boolean,
): boolean {
  if (patternsAreRegex) {
    try {
      return new RegExp(pattern).test(value);
    } catch {
      return false;
    }
  }
  return value.includes(pattern);
}

export function matchesAnyPattern(
  value: string,
  patterns: string[],
  patternsAreRegex: boolean,
): boolean {
  if (patterns.length === 0) return false;
  return patterns.some((pattern) =>
    matchesPattern(value, pattern, patternsAreRegex),
  );
}

export function shouldCrawlUrl(
  url: string,
  options: {
    startUrls?: string[];
    includePatterns: string[];
    excludePatterns: string[];
    excludeDownloadPatterns: string[];
    patternsAreRegex: boolean;
  },
): { allowed: boolean; reason?: string } {
  if (
    matchesAnyPattern(
      url,
      options.excludePatterns,
      options.patternsAreRegex,
    )
  ) {
    return { allowed: false, reason: "Excluded by URL pattern" };
  }

  if (
    matchesAnyPattern(
      url,
      options.excludeDownloadPatterns,
      options.patternsAreRegex,
    )
  ) {
    return { allowed: false, reason: "Excluded from download" };
  }

  const startUrls = options.startUrls ?? [];
  const normalizedUrl = url.replace(/\/$/, "");
  const isExactStart = startUrls.some(
    (start) => start.replace(/\/$/, "") === normalizedUrl,
  );
  const startUrlScopes = getStartUrlScopes(startUrls);
  if (
    !isExactStart &&
    startUrlScopes.length > 0 &&
    !isWithinStartUrlScope(url, startUrlScopes)
  ) {
    return {
      allowed: false,
      reason: "Outside start URL path scope",
    };
  }

  if (options.includePatterns.length > 0) {
    if (
      !matchesAnyPattern(
        url,
        options.includePatterns,
        options.patternsAreRegex,
      )
    ) {
      return { allowed: false, reason: "Does not match include pattern" };
    }
  }

  return { allowed: true };
}
