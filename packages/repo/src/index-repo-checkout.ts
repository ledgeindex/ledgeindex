import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  indexPagesForSource,
  type IndexPageInput,
  type IndexPagesResult,
} from "@ledgeindex/core";
import {
  contentTypeForRepoFile,
  repoChunkLanguageForFile,
} from "./indexable-paths.js";
import { repoFileCanonicalUrl } from "./repo-page-url.js";
import { listRepoIndexableFiles } from "./walk-repo.js";

/** Skip huge single files (bytes). */
export const REPO_MAX_FILE_BYTES = 200_000;

export type IndexRepoCheckoutInput = {
  sourceId: string;
  projectId: string;
  /** Absolute path to a local git checkout. */
  checkoutPath: string;
  githubUrl?: string | null;
  sourceSlug?: string | null;
  maxFiles?: number;
};

export type LoadRepoIndexPagesResult = {
  pages: IndexPageInput[];
  fileCount: number;
  skippedEmpty: number;
  skippedTooLarge: number;
};

/**
 * Read allowlisted files from a checkout into IndexPageInput rows
 * (recursive + language chunking applied later by indexPagesForSource).
 */
export function loadRepoIndexPages(input: {
  checkoutPath: string;
  githubUrl?: string | null;
  sourceSlug?: string | null;
  maxFiles?: number;
}): LoadRepoIndexPagesResult {
  const files = listRepoIndexableFiles(input.checkoutPath, {
    maxFiles: input.maxFiles,
  });
  const pages: IndexPageInput[] = [];
  let skippedEmpty = 0;
  let skippedTooLarge = 0;

  for (const relativePath of files) {
    const abs = join(input.checkoutPath, relativePath);
    let size = 0;
    try {
      size = statSync(abs).size;
    } catch {
      continue;
    }
    if (size > REPO_MAX_FILE_BYTES) {
      skippedTooLarge += 1;
      continue;
    }

    let text = "";
    try {
      text = readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    const trimmed = text.trim();
    if (!trimmed) {
      skippedEmpty += 1;
      continue;
    }

    const chunkLanguage = repoChunkLanguageForFile(relativePath);
    if (!chunkLanguage) continue;

    pages.push({
      url: repoFileCanonicalUrl({
        relativePath,
        githubUrl: input.githubUrl,
        sourceSlug: input.sourceSlug,
      }),
      title: relativePath,
      markdown: trimmed,
      contentType: contentTypeForRepoFile(relativePath),
      language: chunkLanguage,
      chunkStrategy: "recursive",
      chunkLanguage,
    });
  }

  return {
    pages,
    fileCount: files.length,
    skippedEmpty,
    skippedTooLarge,
  };
}

/**
 * Walk a local checkout, chunk with Mastra recursive + language, embed + store.
 */
export async function indexRepoCheckout(
  input: IndexRepoCheckoutInput,
): Promise<
  IndexPagesResult & {
    fileCount: number;
    skippedEmpty: number;
    skippedTooLarge: number;
  }
> {
  const loaded = loadRepoIndexPages({
    checkoutPath: input.checkoutPath,
    githubUrl: input.githubUrl,
    sourceSlug: input.sourceSlug,
    maxFiles: input.maxFiles,
  });

  const result = await indexPagesForSource({
    sourceId: input.sourceId,
    projectId: input.projectId,
    pages: loaded.pages,
  });

  return {
    ...result,
    fileCount: loaded.fileCount,
    skippedEmpty: loaded.skippedEmpty,
    skippedTooLarge: loaded.skippedTooLarge,
  };
}
