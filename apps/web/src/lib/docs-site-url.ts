/**
 * Public docs entry URL. Production: same-origin apex (/docs via Cloudflare Worker).
 * Local dev: separate Next app on :3005 — do not proxy through :3004 (breaks Turbopack HMR).
 */
export function docsSiteHref(): string {
  const fromEnv = process.env.NEXT_PUBLIC_LEDGEINDEX_DOCS_URL?.trim();
  if (fromEnv) return fromEnv;
  if (process.env.NODE_ENV === "development") {
    return "http://localhost:3005/docs";
  }
  return "/docs";
}
