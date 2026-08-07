export const AG_BRAIN_LEDGEINDEX_SOURCE_SLUG = "automationghost-brain";

const BRAIN_PAGE_HOST = "brain.automationghost.local";

export function relativePathFromBrainPageUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== BRAIN_PAGE_HOST) return null;
    const path = parsed.pathname.replace(/^\/+/, "");
    if (!path) return null;
    return path
      .split("/")
      .map((segment) => decodeURIComponent(segment))
      .join("/");
  } catch {
    return null;
  }
}
