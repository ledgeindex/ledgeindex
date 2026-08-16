import { createHash } from "node:crypto";

/**
 * Vector ids must be unique per (url, chunkIndex): the store upserts by id, so
 * two pages sharing an id silently overwrite each other.
 *
 * Encoding a prefix of the URL is not enough. Every file in a repo source lives
 * under the same `https://host/owner/repo/blob/HEAD/packages/...` prefix, which
 * fills a fixed-width encoding before the path ever diverges, so an entire
 * checkout collapses onto a handful of ids. Hash the whole URL instead.
 */
export function hashUrl(url: string): string {
  return createHash("sha256").update(url).digest("base64url").slice(0, 32);
}

export function buildChunkId(input: {
  sourceId: string;
  url: string;
  chunkIndex: number;
}): string {
  return `${input.sourceId}:${hashUrl(input.url)}:${input.chunkIndex}`;
}
