export type RateLimitRouteRule = { method: string; path: string };

export type RateLimitBucket = {
  maxPerWindow: number;
  label?: string;
  routes: RateLimitRouteRule[];
};

/** Same shape as backend-api legacy rate-limit JSON. */
export type RateLimitConfig = {
  api: string;
  version?: number;
  description?: string;
  windowSeconds: number;
  fallback: {
    readMaxPerWindow: number;
    writeMaxPerWindow: number;
    note?: string;
  };
  buckets: Record<string, RateLimitBucket>;
};

export type RateLimitResolution = {
  bucketId: string;
  maxPerWindow: number;
  windowSeconds: number;
  matchedBy: "route" | "fallback";
};
