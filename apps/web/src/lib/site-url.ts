export const LEDGEINDEX_SITE_URL = "https://ledgeindex.com";

export function getSiteUrl(): string {
  const fromEnv = process.env.LEDGEINDEX_PUBLIC_SITE_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  return LEDGEINDEX_SITE_URL;
}
