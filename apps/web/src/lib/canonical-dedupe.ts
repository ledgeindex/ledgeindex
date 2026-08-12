export const CANONICAL_DUPLICATE_PREFIX = "Canonical duplicate of ";

export function isCanonicalDuplicateSkip(reason: string): boolean {
  return reason.startsWith(CANONICAL_DUPLICATE_PREFIX);
}

export function partitionSkippedUrls(skipped: readonly { reason: string }[]): {
  canonicalAliasCount: number;
  httpStatusCount: number;
  otherSkippedCount: number;
} {
  let canonicalAliasCount = 0;
  let httpStatusCount = 0;
  for (const item of skipped) {
    if (isCanonicalDuplicateSkip(item.reason)) {
      canonicalAliasCount += 1;
    } else if (isHttpStatusSkipReason(item.reason)) {
      httpStatusCount += 1;
    }
  }
  return {
    canonicalAliasCount,
    httpStatusCount,
    otherSkippedCount: skipped.length - canonicalAliasCount - httpStatusCount,
  };
}

export function isHttpStatusSkipReason(reason: string): boolean {
  return (
    reason.startsWith("HTTP ") ||
    reason.startsWith("Request failed") ||
    reason.startsWith("Network error")
  );
}

/** Parse `HTTP 404` → 404; network/request failures → null. */
export function parseHttpStatusFromSkipReason(reason: string): number | null {
  const match = /^HTTP\s+(\d{3})\b/i.exec(reason.trim());
  if (!match) return null;
  const status = Number(match[1]);
  return Number.isFinite(status) ? status : null;
}

export type DiscoveredReviewUrl = {
  url: string;
  title?: string;
  /** Set when Filter is off and we keep non-2xx pages in the review list. */
  httpStatus?: number;
  /** Raw skip reason for non-numeric failures (network, etc.). */
  httpErrorReason?: string;
};

/**
 * When Filter is off: move HTTP-error skips back into the URL list (marked),
 * so the user can see them. When Filter is on, leave errors in `skipped`.
 */
export function promoteHttpErrorsIntoReviewList(
  urls: readonly { url: string; title?: string }[],
  skipped: readonly { url: string; reason: string }[],
): {
  urls: DiscoveredReviewUrl[];
  skipped: { url: string; reason: string }[];
  httpErrorCount: number;
} {
  const httpErrors = skipped.filter((item) => isHttpStatusSkipReason(item.reason));
  const otherSkipped = skipped.filter(
    (item) => !isHttpStatusSkipReason(item.reason),
  );
  const seen = new Set(urls.map((item) => item.url));
  const promoted: DiscoveredReviewUrl[] = [];

  for (const item of httpErrors) {
    if (seen.has(item.url)) continue;
    seen.add(item.url);
    const status = parseHttpStatusFromSkipReason(item.reason);
    promoted.push({
      url: item.url,
      ...(status != null
        ? { httpStatus: status }
        : { httpErrorReason: item.reason }),
    });
  }

  return {
    urls: [...urls.map((item) => ({ ...item })), ...promoted],
    skipped: otherSkipped,
    httpErrorCount: httpErrors.length,
  };
}
