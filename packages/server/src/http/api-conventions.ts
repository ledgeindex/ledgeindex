export const API_MAJOR_VERSION = "1";
export const API_VERSION_HEADER = "API-Version";

export function stripV1Prefix(url: string): string {
  if (url === "/v1") return "/";
  if (url.startsWith("/v1/")) return url.slice(3) || "/";
  if (url.startsWith("/v1?")) return `/${url.slice(3)}`;
  return url;
}

export function formatRateLimitHeader(params: {
  limit: number;
  remaining: number;
  resetSeconds: number;
}): string {
  return `limit=${params.limit}, remaining=${params.remaining}, reset=${params.resetSeconds}`;
}

export function formatRateLimitPolicyHeader(params: {
  limit: number;
  windowSeconds: number;
}): string {
  return `${params.limit};w=${params.windowSeconds}`;
}
