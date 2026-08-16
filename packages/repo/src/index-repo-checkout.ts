import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  indexPagesForSource,
  type IndexPageInput,
  type IndexPagesResult,
  type IndexProgress,
} from "@ledgeindex/core";
import { analyzeCodeFile, type CodeFileAnalysis } from "./ast-chunk-code.js";
import { cloneRepo } from "./clone-repo.js";
import {
  contentTypeForRepoFile,
  isRepoCodeFile,
  repoChunkLanguageForFile,
  repoChunkStrategyForFile,
  repoPageKind,
  repoPathFacets,
  type RepoPageKind,
  type RepoPathOptions,
} from "./indexable-paths.js";
import { repoFileCanonicalUrl } from "./repo-page-url.js";
import { walkRepoFiles } from "./walk-repo.js";

/** Skip huge single files (bytes). */
export const REPO_MAX_FILE_BYTES = 200_000;

const SCAN_PROGRESS_EVERY = 25;

export type RepoIndexProgress =
  | { phase: "clone"; detail: string }
  | {
      phase: "scan";
      current: number;
      total: number;
      filePath?: string;
    }
  | IndexProgress;

export type IndexRepoCheckoutInput = RepoPathOptions & {
  sourceId: string;
  projectId: string;
  /**
   * Absolute path to a local git checkout. Optional when `githubUrl` is set —
   * the repository is then cloned into the checkout cache.
   */
  checkoutPath?: string;
  githubUrl?: string | null;
  /** Branch, tag, or commit to clone. Ignored when `checkoutPath` is given. */
  ref?: string | null;
  sourceSlug?: string | null;
  maxFiles?: number;
  onProgress?: (progress: RepoIndexProgress) => void;
};

export type RepoIndexStats = {
  fileCount: number;
  skippedEmpty: number;
  skippedTooLarge: number;
  skippedTests: number;
  skippedReadme: number;
  skippedExtension: number;
  /** Indexed file count per role, so a run reports what kind of corpus it built. */
  pageKindCounts: Record<RepoPageKind, number>;
  /** Code files split on declaration boundaries by the AST chunker. */
  astChunkedFiles: number;
  /** Code files the parser rejected, which fell back to the text splitter. */
  astFallbackFiles: number;
  truncated: boolean;
};

/** Per-file symbol and import data, used to build the repo map. */
export type RepoFileSymbols = {
  relativePath: string;
  url: string;
  pageKind: RepoPageKind;
  imports: string[];
  exports: CodeFileAnalysis["exports"];
};

export type LoadRepoIndexPagesResult = RepoIndexStats & {
  pages: IndexPageInput[];
  fileSymbols: RepoFileSymbols[];
};

/**
 * Read allowlisted files from a checkout into IndexPageInput rows. Chunking is
 * per file kind: code is split on declaration boundaries by the AST chunker,
 * markdown by the same header-aware splitter crawled docs use. Code files the
 * parser cannot handle fall back to the recursive language splitter.
 */
export function loadRepoIndexPages(
  input: RepoPathOptions & {
    checkoutPath: string;
    githubUrl?: string | null;
    sourceSlug?: string | null;
    maxFiles?: number;
    onProgress?: (progress: RepoIndexProgress) => void;
  },
): LoadRepoIndexPagesResult {
  const walk = walkRepoFiles(input.checkoutPath, {
    maxFiles: input.maxFiles,
    includeTests: input.includeTests,
    includeReadme: input.includeReadme,
    extensions: input.extensions,
  });
  const files = walk.files;
  input.onProgress?.({
    phase: "scan",
    current: 0,
    total: Math.max(files.length, 1),
  });
  const pages: IndexPageInput[] = [];
  const pageKindCounts: Record<RepoPageKind, number> = {
    source: 0,
    test: 0,
    example: 0,
    docs: 0,
    config: 0,
  };
  const fileSymbols: RepoFileSymbols[] = [];
  let skippedEmpty = 0;
  let skippedTooLarge = 0;
  let astChunkedFiles = 0;
  let astFallbackFiles = 0;

  for (const [fileIndex, relativePath] of files.entries()) {
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

    const pageKind = repoPageKind(relativePath);
    const facets = repoPathFacets(relativePath);
    pageKindCounts[pageKind] += 1;

    const url = repoFileCanonicalUrl({
      relativePath,
      githubUrl: input.githubUrl,
      sourceSlug: input.sourceSlug,
    });

    const analysis = isRepoCodeFile(relativePath)
      ? analyzeCodeFile({ relativePath, text, pageKind })
      : null;

    if (analysis && !analysis.parseFailed && analysis.chunks.length > 0) {
      astChunkedFiles += 1;
      fileSymbols.push({
        relativePath,
        url,
        pageKind,
        imports: analysis.imports,
        exports: analysis.exports,
      });
    } else if (analysis) {
      astFallbackFiles += 1;
    }

    pages.push({
      url,
      title: relativePath,
      markdown: trimmed,
      contentType: contentTypeForRepoFile(relativePath),
      language: chunkLanguage,
      chunkStrategy: repoChunkStrategyForFile(relativePath),
      chunkLanguage,
      category: facets.category,
      section: facets.section,
      pageKind,
      filePath: relativePath,
      chunks:
        analysis && !analysis.parseFailed && analysis.chunks.length > 0
          ? analysis.chunks.map((codeChunk) => ({
              text: codeChunk.text,
              tokenCount: codeChunk.tokenCount,
              charCount: codeChunk.charCount,
              metadata: {
                filePath: relativePath,
                startLine: codeChunk.startLine,
                endLine: codeChunk.endLine,
                symbolName: codeChunk.symbolName,
                symbolPath: codeChunk.symbolPath,
                symbolKind: codeChunk.symbolKind,
                exportedSymbol: codeChunk.exported,
                ...(codeChunk.partCount && codeChunk.partCount > 1
                  ? {
                      partIndex: codeChunk.partIndex,
                      partCount: codeChunk.partCount,
                    }
                  : {}),
              },
            }))
          : undefined,
    });

    if (
      input.onProgress &&
      (fileIndex % SCAN_PROGRESS_EVERY === 0 ||
        fileIndex === files.length - 1)
    ) {
      input.onProgress({
        phase: "scan",
        current: fileIndex + 1,
        total: files.length,
        filePath: relativePath,
      });
    }
  }

  return {
    pages,
    fileSymbols,
    fileCount: files.length,
    skippedEmpty,
    skippedTooLarge,
    skippedTests: walk.skippedTests,
    skippedReadme: walk.skippedReadme,
    skippedExtension: walk.skippedExtension,
    pageKindCounts,
    astChunkedFiles,
    astFallbackFiles,
    truncated: walk.truncated,
  };
}

/**
 * Walk a local checkout, chunk per file kind, embed + store.
 */
export async function indexRepoCheckout(
  input: IndexRepoCheckoutInput,
): Promise<
  IndexPagesResult &
    RepoIndexStats & {
      exportedSymbolCount: number;
      importEdgeCount: number;
      checkoutPath: string;
      /** Set when the checkout was cloned rather than supplied. */
      commitSha?: string;
    }
> {
  let checkoutPath = input.checkoutPath;
  let commitSha: string | undefined;

  if (!checkoutPath) {
    if (!input.githubUrl?.trim()) {
      throw new Error(
        "indexRepoCheckout needs either a checkoutPath or a githubUrl to clone",
      );
    }
    input.onProgress?.({
      phase: "clone",
      detail: `Cloning ${input.githubUrl}`,
    });
    const clone = await cloneRepo({
      repoUrl: input.githubUrl,
      ref: input.ref ?? null,
    });
    checkoutPath = clone.checkoutPath;
    commitSha = clone.commitSha;
  } else {
    input.onProgress?.({
      phase: "clone",
      detail: `Using checkout ${checkoutPath}`,
    });
  }

  const { pages, fileSymbols, ...stats } = loadRepoIndexPages({
    checkoutPath,
    githubUrl: input.githubUrl,
    sourceSlug: input.sourceSlug,
    maxFiles: input.maxFiles,
    includeTests: input.includeTests,
    includeReadme: input.includeReadme,
    extensions: input.extensions,
    onProgress: input.onProgress,
  });

  const result = await indexPagesForSource({
    sourceId: input.sourceId,
    projectId: input.projectId,
    pages,
    onProgress: input.onProgress,
  });

  return {
    ...result,
    ...stats,
    checkoutPath,
    ...(commitSha ? { commitSha } : {}),
    exportedSymbolCount: fileSymbols.reduce(
      (total, file) => total + file.exports.length,
      0,
    ),
    importEdgeCount: fileSymbols.reduce(
      (total, file) => total + file.imports.length,
      0,
    ),
  };
}
