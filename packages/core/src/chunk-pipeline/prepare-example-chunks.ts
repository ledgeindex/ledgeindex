import { chunk } from "../chunk/chunk.js";
import { apiResponseMetaToChunkMetadata } from "../enrich/api-response-meta.js";
import type { EnrichedExample, EnrichPageResult } from "../enrich/schemas.js";

export const DEFAULT_EXAMPLE_CODE_MAX_CHARS = 2000;

export function getExampleCodeMaxChars(): number {
  const raw = Number(process.env.LEDGEINDEX_EXAMPLE_CODE_MAX_CHARS);
  if (Number.isFinite(raw) && raw > 0) return Math.floor(raw);
  return DEFAULT_EXAMPLE_CODE_MAX_CHARS;
}

function hashUrl(url: string): string {
  return Buffer.from(url).toString("base64url").slice(0, 80);
}

function contextPrefix(input: {
  pageTitle: string;
  pageSummary: string;
  section: string;
  kind: string;
  title: string;
  description: string;
  language: string | null;
  partLabel?: string;
}): string {
  const language =
    input.language && input.language.trim().length > 0
      ? ` | Language: ${input.language.trim()}`
      : "";
  const part = input.partLabel ? ` | ${input.partLabel}` : "";
  return [
    `Page: ${input.pageTitle.trim() || "Untitled"}`,
    `Section: ${input.section}`,
    `Kind: ${input.kind}${language}${part}`,
    `Topic: ${input.title}`,
    `Summary: ${input.description}`,
    `Page context: ${input.pageSummary}`,
  ].join(" | ");
}

export type ExampleChunkDraft = {
  id: string;
  text: string;
  metadata: Record<string, unknown>;
};

/**
 * Turn enriched page examples into embeddable chunk drafts.
 * Small examples → one vector (full embedText).
 * Large code/config → recursive strategy parts with shared parent prefix.
 * Large setup/usage → semantic-markdown parts with shared parent prefix.
 */
export async function prepareExampleChunkDrafts(input: {
  sourceId: string;
  projectId: string;
  url: string;
  title: string;
  enrichment: EnrichPageResult;
  baseMetadata?: Record<string, unknown>;
}): Promise<ExampleChunkDraft[]> {
  if (input.enrichment.status !== "enriched") return [];

  const { pageSummary, examples } = input.enrichment;
  const urlHash = hashUrl(input.url);
  const maxChars = getExampleCodeMaxChars();
  const drafts: ExampleChunkDraft[] = [];

  for (const example of examples) {
    const sharedMeta = {
      ...(input.baseMetadata ?? {}),
      chunkKind: "example",
      exampleKind: example.kind,
      exampleIndex: example.exampleIndex,
      exampleTitle: example.title,
      section: example.section,
      /** Syntax language for the example (null when prose-only). */
      language: example.language,
      /** Dedicated key so page-locale `language` never collides. */
      exampleLanguage: example.language,
      pageSummary,
      body: example.body,
      parentUrl: input.url,
      url: input.url,
      title: input.title,
      sourceId: input.sourceId,
      projectId: input.projectId,
      ...apiResponseMetaToChunkMetadata(example.apiResponse),
    };

    const overThreshold = example.body.length > maxChars;
    const isCodeLike =
      example.kind === "code" ||
      example.kind === "config" ||
      example.kind === "api_response";

    if (!overThreshold) {
      drafts.push({
        id: `${input.sourceId}:${urlHash}:ex:${example.exampleIndex}`,
        text: example.embedText,
        metadata: { ...sharedMeta, text: example.embedText },
      });
      continue;
    }

    const parts = isCodeLike
      ? await chunk(example.body, {
          strategy: "recursive",
          language: example.language,
        })
      : await chunk(example.body, { strategy: "semantic-markdown" });

    if (parts.length === 0) {
      drafts.push({
        id: `${input.sourceId}:${urlHash}:ex:${example.exampleIndex}`,
        text: example.embedText,
        metadata: { ...sharedMeta, text: example.embedText },
      });
      continue;
    }

    for (const [partIndex, part] of parts.entries()) {
      const prefix = contextPrefix({
        pageTitle: input.title,
        pageSummary,
        section: example.section,
        kind: example.kind,
        title: example.title,
        description: example.description,
        language: example.language,
        partLabel: `Part ${partIndex + 1}/${parts.length}`,
      });
      const embedText = `${prefix} | Example:\n${part.text}`;
      drafts.push({
        id: `${input.sourceId}:${urlHash}:ex:${example.exampleIndex}:p:${partIndex}`,
        text: embedText,
        metadata: {
          ...sharedMeta,
          text: embedText,
          examplePartIndex: partIndex,
          examplePartCount: parts.length,
          body: part.text,
          fullBody: example.body,
        },
      });
    }
  }

  return drafts;
}

export function pagesWithEnrichmentExamples(
  pages: Array<{ enrichment?: EnrichPageResult | null }>,
): number {
  return pages.filter((p) => p.enrichment?.status === "enriched").length;
}

export type { EnrichedExample };
