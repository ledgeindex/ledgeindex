/**
 * Layered abuse controls for public widget chat.
 *
 * Origin allowlisting stops other *websites* from embedding the widget (browsers
 * cannot forge Origin). Direct API callers can still send a fake Origin header —
 * IP + per-widget budgets make that expensive, not cryptographically impossible.
 */

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

function envInt(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Sliding fixed window: returns false when over limit. */
export function takeRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): boolean {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (bucket.count >= limit) return false;
  bucket.count += 1;
  return true;
}

/** Best-effort client IP (set trustProxy on the Fastify host in production). */
export function widgetClientIp(request: {
  ip: string;
  headers: Record<string, string | string[] | undefined>;
}): string {
  const forwarded = request.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  if (Array.isArray(forwarded) && forwarded[0]) {
    const first = String(forwarded[0]).split(",")[0]?.trim();
    if (first) return first;
  }
  return request.ip || "unknown";
}

export type WidgetAbuseLimits = {
  /** Max chats per client IP per minute (all widgets). */
  ipPerMinute: number;
  /** Max chats per websiteId per minute (any origin). */
  sitePerMinute: number;
  /** Max chats per websiteId+origin per minute (normal embed traffic). */
  siteOriginPerMinute: number;
};

export function getWidgetAbuseLimits(): WidgetAbuseLimits {
  return {
    ipPerMinute: envInt("WIDGET_RATE_IP_PER_MIN", 20),
    sitePerMinute: envInt("WIDGET_RATE_SITE_PER_MIN", 60),
    siteOriginPerMinute: envInt("WIDGET_RATE_SITE_ORIGIN_PER_MIN", 40),
  };
}

export type WidgetAbuseDecision =
  | { ok: true }
  | { ok: false; status: 429; error: string };

/**
 * Apply layered limits. Call after origin allowlist passes.
 */
export function enforceWidgetAbuseLimits(input: {
  websiteId: string;
  origin: string;
  clientIp: string;
}): WidgetAbuseDecision {
  const limits = getWidgetAbuseLimits();
  const { websiteId, origin, clientIp } = input;

  if (!takeRateLimit(`widget:ip:${clientIp}`, limits.ipPerMinute, 60_000)) {
    return {
      ok: false,
      status: 429,
      error: "Too many requests from this network. Try again shortly.",
    };
  }

  if (
    !takeRateLimit(
      `widget:site:${websiteId}`,
      limits.sitePerMinute,
      60_000,
    )
  ) {
    return {
      ok: false,
      status: 429,
      error: "Widget rate limit exceeded. Try again shortly.",
    };
  }

  if (
    !takeRateLimit(
      `widget:site-origin:${websiteId}:${origin}`,
      limits.siteOriginPerMinute,
      60_000,
    )
  ) {
    return {
      ok: false,
      status: 429,
      error: "Rate limit exceeded for this origin. Try again shortly.",
    };
  }

  return { ok: true };
}

/** Drop expired buckets occasionally so the map does not grow forever. */
export function pruneWidgetRateBuckets(now = Date.now()): void {
  if (buckets.size < 2_000) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}
