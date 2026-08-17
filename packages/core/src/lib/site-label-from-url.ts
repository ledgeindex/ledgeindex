import { slugifySourceName } from "./source-slug.js";

/** Common multi-part public suffixes (best-effort; not a full PSL). */
const MULTI_PART_PUBLIC_SUFFIXES = new Set([
  "co.uk",
  "org.uk",
  "ac.uk",
  "gov.uk",
  "com.au",
  "net.au",
  "org.au",
  "co.jp",
  "co.nz",
  "co.za",
]);

export function registrableDomain(hostname: string): string {
  const host = hostname.replace(/^www\./i, "").toLowerCase();
  const parts = host.split(".").filter(Boolean);
  if (parts.length <= 2) return host;

  const lastTwo = parts.slice(-2).join(".");
  if (MULTI_PART_PUBLIC_SUFFIXES.has(lastTwo) && parts.length >= 3) {
    return parts.slice(-3).join(".");
  }

  return lastTwo;
}

export function hostnameLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return "Web source";
  }
}

/** Stable slug from the site's registrable domain (e.g. mastra.ai → mastra). */
export function siteSlugFromUrl(url: string): string {
  try {
    const hostname = new URL(url).hostname;
    const domain = registrableDomain(hostname);
    const label = domain.split(".").find(Boolean) ?? domain;
    return slugifySourceName(label);
  } catch {
    return "source";
  }
}

/** Short display name from the site's registrable domain (e.g. mastra.ai → Mastra). */
export function siteNameFromUrl(url: string): string {
  const slug = siteSlugFromUrl(url);
  if (!slug || slug === "source") return hostnameLabel(url);
  return slug.charAt(0).toUpperCase() + slug.slice(1);
}

/** Heuristic: page titles like "Get started with Mastra" are not site names. */
export function looksLikeDocPageTitle(title: string): boolean {
  const trimmed = title.trim();
  if (!trimmed) return false;
  const lower = trimmed.toLowerCase();
  return (
    trimmed.length > 48 ||
    /\b(get started|getting started|introduction|overview|quickstart|quick start|tutorial|how to|api reference|changelog|documentation|welcome to|step-by-step)\b/.test(
      lower,
    )
  );
}
