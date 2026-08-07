/**
 * Resolve the nearest markdown heading above an example body.
 * Always returns a non-empty section string.
 */

const HEADING_LINE_RE = /^(#{1,6})\s+(.+)$/;

function normalizeForMatch(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\s+/g, " ").trim();
}

function findBodyIndex(markdown: string, body: string): number {
  const needle = body.trim();
  if (!needle) return -1;

  const exact = markdown.indexOf(needle);
  if (exact >= 0) return exact;

  // First non-empty line often survives light LLM reformatting.
  const firstLine = needle.split("\n").map((l) => l.trim()).find(Boolean);
  if (firstLine && firstLine.length >= 12) {
    const idx = markdown.indexOf(firstLine);
    if (idx >= 0) return idx;
  }

  const compactNeedle = normalizeForMatch(needle).slice(0, 120);
  if (compactNeedle.length < 16) return -1;
  const compactMd = normalizeForMatch(markdown);
  const compactIdx = compactMd.indexOf(compactNeedle);
  if (compactIdx < 0) return -1;

  // Approximate back to original index via character ratio (good enough for heading walk).
  const ratio = compactIdx / Math.max(compactMd.length, 1);
  return Math.floor(ratio * markdown.length);
}

function headingBeforeIndex(markdown: string, index: number): string | null {
  if (index < 0) return null;
  const before = markdown.slice(0, index);
  const lines = before.split("\n");
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const match = HEADING_LINE_RE.exec(lines[i]!.trim());
    if (!match) continue;
    const title = match[2]!.trim();
    if (title) return title;
  }
  return null;
}

function firstPageHeading(markdown: string): string | null {
  for (const line of markdown.split("\n")) {
    const match = HEADING_LINE_RE.exec(line.trim());
    if (!match) continue;
    const title = match[2]!.trim();
    if (title) return title;
  }
  return null;
}

export function resolveExampleSection(input: {
  markdown: string;
  body: string;
  llmSection?: string | null;
  pageTitle?: string;
}): string {
  const fromLlm = input.llmSection?.trim();
  if (fromLlm) return fromLlm;

  const bodyIndex = findBodyIndex(input.markdown, input.body);
  const nearest = headingBeforeIndex(input.markdown, bodyIndex);
  if (nearest) return nearest;

  const first = firstPageHeading(input.markdown);
  if (first) return first;

  const pageTitle = input.pageTitle?.trim();
  if (pageTitle) return pageTitle;

  return "General";
}
