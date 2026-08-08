export const CANONICAL_DUPLICATE_PREFIX = "Canonical duplicate of ";

export function isCanonicalDuplicateSkip(reason: string): boolean {
  return reason.startsWith(CANONICAL_DUPLICATE_PREFIX);
}

export function partitionSkippedUrls(skipped: readonly { reason: string }[]): {
  canonicalAliasCount: number;
  otherSkippedCount: number;
} {
  let canonicalAliasCount = 0;
  for (const item of skipped) {
    if (isCanonicalDuplicateSkip(item.reason)) canonicalAliasCount += 1;
  }
  return {
    canonicalAliasCount,
    otherSkippedCount: skipped.length - canonicalAliasCount,
  };
}
