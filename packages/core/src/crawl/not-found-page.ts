/** HTTP status helpers for crawl error-page filtering (no title/body heuristics). */

export function isNonSuccessHttpStatus(
  status: number | null | undefined,
): boolean {
  if (status == null || !Number.isFinite(status) || status <= 0) return false;
  return status < 200 || status >= 300;
}

export function httpStatusSkipReason(status: number): string {
  return `HTTP ${status}`;
}
