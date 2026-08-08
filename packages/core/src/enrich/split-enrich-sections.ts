import { chunk } from "../chunk/chunk.js";
import { countTokens } from "../lib/count-tokens.js";

export type EnrichMarkdownSection = {
  index: number;
  /** Heading-aware markdown slice (possibly several headings packed together). */
  markdown: string;
  tokenCount: number;
  charCount: number;
};

/**
 * Greedily join consecutive heading pieces until adding the next would exceed
 * `maxTokens`. Goal: few enrich LLM calls that each fill the context budget,
 * not one request per tiny heading.
 */
export function packEnrichSections(
  pieces: EnrichMarkdownSection[],
  maxTokens: number,
): EnrichMarkdownSection[] {
  const budget =
    Number.isFinite(maxTokens) && maxTokens > 0 ? Math.floor(maxTokens) : 2_500;
  if (pieces.length === 0) return [];

  const packed: EnrichMarkdownSection[] = [];
  let bucket: string[] = [];

  const flush = () => {
    if (bucket.length === 0) return;
    const markdown = bucket.join("\n\n").trim();
    if (!markdown) {
      bucket = [];
      return;
    }
    packed.push({
      index: packed.length,
      markdown,
      tokenCount: countTokens(markdown),
      charCount: markdown.length,
    });
    bucket = [];
  };

  for (const piece of pieces) {
    const text = piece.markdown.trim();
    if (!text) continue;

    if (bucket.length === 0) {
      // Oversized single piece stays alone; whole-pass truncation still applies later.
      if (piece.tokenCount > budget) {
        packed.push({
          index: packed.length,
          markdown: text,
          tokenCount: piece.tokenCount,
          charCount: text.length,
        });
        continue;
      }
      bucket.push(text);
      continue;
    }

    const tentative = `${bucket.join("\n\n")}\n\n${text}`;
    const tentativeTokens = countTokens(tentative);
    if (tentativeTokens > budget) {
      flush();
      if (piece.tokenCount > budget) {
        packed.push({
          index: packed.length,
          markdown: text,
          tokenCount: piece.tokenCount,
          charCount: text.length,
        });
      } else {
        bucket.push(text);
      }
      continue;
    }

    bucket.push(text);
  }

  flush();
  return packed;
}

/**
 * Split page markdown into heading-aware pieces via Mastra `semantic-markdown`,
 * then pack consecutive pieces up to `maxTokens` so enrich only needs a few
 * LLM passes (not one per heading).
 */
export async function splitEnrichSections(
  markdown: string,
  options?: {
    /** Max tokens per packed enrich batch (context-safe budget). */
    maxTokens?: number;
    overlap?: number;
    joinThreshold?: number;
    /** Skip packing (tests / debugging). */
    pack?: boolean;
  },
): Promise<EnrichMarkdownSection[]> {
  const source = markdown.trim();
  if (!source) return [];

  const maxTokens = options?.maxTokens ?? 2_500;
  // Fine heading cuts first — packing below fills each request toward maxTokens.
  const fineMax = Math.min(800, Math.max(250, Math.floor(maxTokens / 3)));
  const joinThreshold =
    options?.joinThreshold ?? Math.min(120, Math.floor(fineMax / 4));

  const chunks = await chunk(source, {
    strategy: "semantic-markdown",
    maxSize: fineMax,
    overlap: options?.overlap ?? 40,
    joinThreshold,
  });

  const fine: EnrichMarkdownSection[] =
    chunks.length === 0
      ? [
          {
            index: 0,
            markdown: source,
            tokenCount: countTokens(source),
            charCount: source.length,
          },
        ]
      : chunks.map((part, index) => {
          const text = part.text;
          return {
            index,
            markdown: text,
            tokenCount: part.tokenCount ?? countTokens(text),
            charCount: part.charCount ?? text.length,
          };
        });

  if (options?.pack === false) return fine;
  if (fine.length <= 1) return fine;

  return packEnrichSections(fine, maxTokens);
}
