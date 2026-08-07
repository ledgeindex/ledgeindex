import { isToolPart } from "@/components/chat/chat-tool-result-card";
import { readRetrievalFromParts } from "@/lib/retrieval-meta";
import type { ToolUIPart, UIMessage } from "ai";

export type CitationSource = {
  url: string;
  title: string;
  description?: string;
  quote?: string;
  /** Knowledge catalog / platform source name (e.g. Mastra, Kapa). */
  catalogName?: string;
};

function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url.trim());
    parsed.hash = "";
    const path = parsed.pathname.replace(/\/+$/, "") || "/";
    return `${parsed.origin}${path}${parsed.search}`;
  } catch {
    return url.trim().replace(/\/+$/, "");
  }
}

function quoteFromText(text: string | undefined): string | undefined {
  const trimmed = text?.replace(/\s+/g, " ").trim();
  if (!trimmed) return undefined;
  return trimmed.length > 220 ? `${trimmed.slice(0, 217)}…` : trimmed;
}

function readToolChunkSources(part: ToolUIPart): CitationSource[] {
  const output = part.output;
  if (!output || typeof output !== "object") return [];

  const record = output as {
    chunks?: Array<{ url?: string; title?: string; text?: string }>;
    hits?: Array<{ url?: string; title?: string; text?: string }>;
  };
  // docsSearch → chunks; ask_source (explore) → hits
  const rows = Array.isArray(record.chunks)
    ? record.chunks
    : Array.isArray(record.hits)
      ? record.hits
      : [];
  if (rows.length === 0) return [];

  const entries: CitationSource[] = [];
  for (const chunk of rows) {
    const url = chunk.url?.trim();
    if (!url) continue;
    entries.push({
      url,
      title: chunk.title?.trim() || url,
      quote: quoteFromText(chunk.text),
    });
  }
  return entries;
}

function readUrlSources(parts: UIMessage["parts"]): CitationSource[] {
  const entries: CitationSource[] = [];
  for (const part of parts) {
    if (part.type !== "source-url") continue;
    const url = "url" in part ? String(part.url ?? "").trim() : "";
    if (!url) continue;
    const title =
      "title" in part && typeof part.title === "string" && part.title.trim()
        ? part.title.trim()
        : url;
    entries.push({ url, title });
  }
  return entries;
}

export function collectMessageCitationSources(
  parts: UIMessage["parts"],
): CitationSource[] {
  const urlSources = readUrlSources(parts);
  const toolSources = parts
    .filter(isToolPart)
    .flatMap((part) => readToolChunkSources(part as ToolUIPart));
  const retrieval = readRetrievalFromParts(parts);
  const retrievalSources =
    retrieval?.chunks.map((chunk) => ({
      url: chunk.url,
      title: chunk.title?.trim() || chunk.url,
      description:
        [chunk.section, chunk.category].filter(Boolean).join(" · ") ||
        undefined,
      catalogName: chunk.category?.trim() || undefined,
      quote: quoteFromText(chunk.text),
    })) ?? [];

  const merged: CitationSource[] = [];
  const seen = new Set<string>();
  for (const source of [...urlSources, ...toolSources, ...retrievalSources]) {
    const key = normalizeUrl(source.url);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(source);
  }
  return merged;
}

export function findCitationSourcesForHref(
  sources: CitationSource[],
  href: string | undefined,
): CitationSource[] {
  if (!href?.trim()) return [];
  const key = normalizeUrl(href);
  const exact = sources.filter((source) => normalizeUrl(source.url) === key);
  if (exact.length > 0) return exact;

  try {
    const target = new URL(href);
    return sources.filter((source) => {
      try {
        const candidate = new URL(source.url);
        return (
          candidate.origin === target.origin &&
          (candidate.pathname === target.pathname ||
            candidate.pathname.startsWith(`${target.pathname}/`) ||
            target.pathname.startsWith(`${candidate.pathname}/`))
        );
      } catch {
        return false;
      }
    });
  } catch {
    return [];
  }
}
