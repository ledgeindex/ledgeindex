import type {
  RateLimitConfig,
  RateLimitResolution,
} from "./types.js";

function normalizePath(urlPath: string): string {
  const withoutQuery = urlPath.split("?")[0] ?? "";
  return withoutQuery.startsWith("/") ? withoutQuery : `/${withoutQuery}`;
}

/** Segment match: `:param` accepts any single path segment. */
export function matchPathTemplate(template: string, pathname: string): boolean {
  const tSeg = template.split("/").filter(Boolean);
  const pSeg = pathname.split("/").filter(Boolean);
  if (tSeg.length !== pSeg.length) return false;
  for (let i = 0; i < tSeg.length; i++) {
    const ts = tSeg[i]!;
    if (ts.startsWith(":")) continue;
    if (pSeg[i] !== ts) return false;
  }
  return true;
}

function pathSpecificity(template: string): number {
  const parts = template.split("/").filter(Boolean);
  let score = parts.length * 10;
  for (const p of parts) {
    if (!p.startsWith(":")) score += 1;
  }
  return score;
}

type FlatRule = {
  method: string;
  path: string;
  bucketId: string;
  maxPerWindow: number;
};

function buildSortedRules(config: RateLimitConfig): FlatRule[] {
  const rules: FlatRule[] = [];
  for (const [bucketId, bucket] of Object.entries(config.buckets)) {
    for (const route of bucket.routes) {
      rules.push({
        method: route.method.toUpperCase(),
        path: route.path,
        bucketId,
        maxPerWindow: bucket.maxPerWindow,
      });
    }
  }
  rules.sort((a, b) => pathSpecificity(b.path) - pathSpecificity(a.path));
  return rules;
}

export type RateLimitResolver = {
  resolve(method: string, urlPath: string): RateLimitResolution | null;
  windowMs(): number;
};

/**
 * Maps METHOD + pathname to a bucket under one or more URL prefixes
 * (same idea as backend-api `createLegacyRateLimitResolver`).
 */
export function createRateLimitResolver(
  prefixes: string | string[],
  config: RateLimitConfig,
): RateLimitResolver {
  const prefixList = (Array.isArray(prefixes) ? prefixes : [prefixes]).map(
    (p) => (p.endsWith("/") ? p.slice(0, -1) : p),
  );
  const sortedRules = buildSortedRules(config);

  function resolve(
    method: string,
    urlPath: string,
  ): RateLimitResolution | null {
    const m = method.toUpperCase();
    const path = normalizePath(urlPath);
    const ok = prefixList.some((p) => path === p || path.startsWith(`${p}/`));
    if (!ok) return null;

    for (const rule of sortedRules) {
      if (rule.method !== m) continue;
      if (matchPathTemplate(rule.path, path)) {
        return {
          bucketId: rule.bucketId,
          maxPerWindow: rule.maxPerWindow,
          windowSeconds: config.windowSeconds,
          matchedBy: "route",
        };
      }
    }

    const fb = config.fallback;
    const isRead = m === "GET" || m === "HEAD" || m === "OPTIONS";
    return {
      bucketId: isRead ? "fallback_read" : "fallback_write",
      maxPerWindow: isRead ? fb.readMaxPerWindow : fb.writeMaxPerWindow,
      windowSeconds: config.windowSeconds,
      matchedBy: "fallback",
    };
  }

  function windowMs(): number {
    return config.windowSeconds * 1000;
  }

  return { resolve, windowMs };
}
