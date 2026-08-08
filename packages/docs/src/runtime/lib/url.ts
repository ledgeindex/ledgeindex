export function normalizeStartUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return trimmed;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

export const UNSUPPORTED_PDF_START_URL_MESSAGE =
  "PDF URLs are not supported for web crawl. Use an HTML docs page as the start URL.";

export function isPdfUrl(input: string): boolean {
  const trimmed = input.trim();
  if (!trimmed) return false;

  try {
    const url = new URL(normalizeStartUrl(trimmed));
    const path = url.pathname.toLowerCase();
    return path.endsWith(".pdf") || /\/[^/]+\.pdf\//i.test(path);
  } catch {
    return /\.pdf(?:$|[?#])/i.test(trimmed);
  }
}
