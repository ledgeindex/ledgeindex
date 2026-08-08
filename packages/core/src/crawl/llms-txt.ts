/** Max bytes stored on source metadata (not indexed as chunks). */
const MAX_LLMS_TXT_BYTES = 512_000;

export type LlmsTxtCapture = {
  url: string;
  content: string;
  truncated?: boolean;
};

function looksLikeLlmsTxt(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return trimmed.startsWith("#") || trimmed.includes(".md") || trimmed.includes("llms");
}

export async function fetchRootLlmsTxt(
  origin: string,
  userAgent: string,
): Promise<LlmsTxtCapture | null> {
  const url = `${origin}/llms.txt`;

  try {
    const response = await fetch(url, {
      headers: { "User-Agent": userAgent, Accept: "text/plain,text/markdown,*/*" },
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) return null;

    const contentType = response.headers.get("content-type") ?? "";
    if (
      contentType.includes("text/html") ||
      contentType.includes("application/json")
    ) {
      return null;
    }

    const body = await response.text();
    if (!looksLikeLlmsTxt(body)) return null;

    const trimmed = body.trim();
    const encoder = new TextEncoder();
    const bytes = encoder.encode(trimmed);
    if (bytes.length <= MAX_LLMS_TXT_BYTES) {
      return { url, content: trimmed };
    }

    const slice = bytes.slice(0, MAX_LLMS_TXT_BYTES);
    const content = new TextDecoder().decode(slice).trimEnd();
    return { url, content, truncated: true };
  } catch {
    return null;
  }
}
