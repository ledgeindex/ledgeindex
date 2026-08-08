/**
 * Normalize a documentation start URL for duplicate / family matching.
 * Strips query/hash and common version path segments (e.g. /v3/, /v16/).
 */
export function normalizeCanonicalUrl(raw: string): string {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return "";

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return trimmed.toLowerCase();
  }

  url.hash = "";
  url.search = "";

  let pathname = url.pathname.replace(/\/+$/, "") || "/";
  const segments = pathname.split("/").filter(Boolean);
  const stripped = segments.filter((segment) => !isVersionPathSegment(segment));
  pathname = stripped.length > 0 ? `/${stripped.join("/")}` : "/";

  const host = url.hostname.toLowerCase();
  const port =
    url.port && !((url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80"))
      ? `:${url.port}`
      : "";

  return `${url.protocol}//${host}${port}${pathname === "/" ? "" : pathname}`;
}

function isVersionPathSegment(segment: string): boolean {
  if (/^v\d+(?:\.\d+)*$/i.test(segment)) return true;
  if (/^\d+(?:\.\d+)*$/.test(segment)) return true;
  if (/^(?:nextjs|react|vue|angular)-\d+/i.test(segment)) return true;
  return false;
}

export function defaultVersionLabel(input: {
  versionNumber: number;
  detectedVersion?: string | null;
  userLabel?: string | null;
}): string {
  const user = String(input.userLabel ?? "").trim();
  if (user) return user;
  const detected = String(input.detectedVersion ?? "").trim();
  if (detected) return detected.startsWith("v") ? detected : `v${detected}`;
  return `v${input.versionNumber}`;
}
