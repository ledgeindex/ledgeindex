export const UNSUPPORTED_PDF_START_URL_MESSAGE =
  "PDF URLs are not supported for web crawl. Use an HTML docs page as the start URL.";

export class UnsupportedStartUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedStartUrlError";
  }
}

/** True when the URL path looks like a PDF (filename / extension). */
export function isPdfUrl(input: string): boolean {
  const trimmed = input.trim();
  if (!trimmed) return false;

  try {
    const url = new URL(
      /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`,
    );
    const path = url.pathname.toLowerCase();
    return path.endsWith(".pdf") || /\/[^/]+\.pdf\//i.test(path);
  } catch {
    return /\.pdf(?:$|[?#])/i.test(trimmed);
  }
}

/** True when an HTTP Content-Type header indicates a PDF body. */
export function isPdfContentType(
  contentType: string | null | undefined,
): boolean {
  if (!contentType?.trim()) return false;
  const type = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  return (
    type === "application/pdf" ||
    type === "application/x-pdf" ||
    type.endsWith("/pdf")
  );
}

export function assertHtmlStartUrl(url: string): void {
  if (isPdfUrl(url)) {
    throw new UnsupportedStartUrlError(UNSUPPORTED_PDF_START_URL_MESSAGE);
  }
}
