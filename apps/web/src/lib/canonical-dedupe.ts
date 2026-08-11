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
