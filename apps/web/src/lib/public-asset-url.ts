/**
 * Public asset URLs for web + desktop.
 * Root-absolute `/images/...` breaks under Electron `loadFile` (file://) —
 * desktop needs a path relative to index.html.
 */
export function publicAssetUrl(path: string): string {
  const raw = path.trim();
  if (!raw || /^https?:\/\//i.test(raw) || raw.startsWith("data:")) {
    return raw;
  }

  const qIndex = raw.indexOf("?");
  const pathname = qIndex >= 0 ? raw.slice(0, qIndex) : raw;
  const query = qIndex >= 0 ? raw.slice(qIndex) : "";
  const normalized = pathname.replace(/^\//, "");

  if (typeof window !== "undefined") {
    const w = window as Window & { ledgeindexDesktop?: { isDesktop?: boolean } };
    if (w.ledgeindexDesktop?.isDesktop) {
      return `./${normalized}${query}`;
    }
  }

  return `/${normalized}${query}`;
}
