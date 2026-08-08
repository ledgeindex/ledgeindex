import { decode, encode } from "gpt-tokenizer";

/**
 * Count tokens with gpt-tokenizer (same encoder used across Pindown).
 * Falls back to ~4 chars/token only if encoding throws.
 */
export function countTokens(text: string): number {
  if (!text) return 0;
  try {
    return encode(text).length;
  } catch {
    return Math.ceil(text.length / 4);
  }
}

/**
 * Truncate text to at most `maxTokens` using gpt-tokenizer encode/decode.
 * Appends a truncation marker when content was cut.
 */
export function truncateToTokenLimit(
  text: string,
  maxTokens: number,
  marker = "\n\n…[truncated]",
): { text: string; truncated: boolean; tokenCount: number } {
  if (!text) return { text: "", truncated: false, tokenCount: 0 };
  if (!Number.isFinite(maxTokens) || maxTokens <= 0) {
    return { text: "", truncated: text.length > 0, tokenCount: 0 };
  }

  let tokens: number[];
  try {
    tokens = encode(text);
  } catch {
    const approxChars = Math.floor(maxTokens * 4);
    if (text.length <= approxChars) {
      return { text, truncated: false, tokenCount: Math.ceil(text.length / 4) };
    }
    return {
      text: `${text.slice(0, approxChars)}${marker}`,
      truncated: true,
      tokenCount: maxTokens,
    };
  }

  if (tokens.length <= maxTokens) {
    return { text, truncated: false, tokenCount: tokens.length };
  }

  const markerTokens = encode(marker);
  const keep = Math.max(0, maxTokens - markerTokens.length);
  const truncatedText = `${decode(tokens.slice(0, keep))}${marker}`;
  return {
    text: truncatedText,
    truncated: true,
    tokenCount: countTokens(truncatedText),
  };
}
