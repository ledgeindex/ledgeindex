import type {
  SourceCorpusExport,
  SourceCorpusPage,
} from "@ledgeindex/core/export/source-corpus.js";
import {
  PROFILE_SEED_MAX_MARKDOWN_CHARS,
  PROFILE_SEED_MAX_PAGES,
  sourceCorpusPagesToProfileSeedPages,
} from "@ledgeindex/core/export/source-corpus.js";
import type {
  CompanyProfileResult,
  SeedCatalogPage,
} from "@ledgeindex/profile";
import { exportCorpus } from "./export-corpus.js";
import {
  profileWithResolvedOptions,
  type LedgeIndexProfileOptions,
} from "./profile.js";
import { resolveOptions } from "./resolve-options.js";
import type {
  LedgeIndexOptions,
  ResolvedLedgeIndexOptions,
} from "./types.js";

export const PROFILE_INDEXED_SOURCE_MAX_PAGES = PROFILE_SEED_MAX_PAGES;
export const PROFILE_INDEXED_SOURCE_MAX_MARKDOWN_CHARS =
  PROFILE_SEED_MAX_MARKDOWN_CHARS;

export type ProfileIndexedSourceOptions = Omit<
  LedgeIndexProfileOptions,
  "lenses" | "seedPages" | "maxPages" | "sitemapOnly"
> & {
  maxSeedPages?: number;
  maxMarkdownChars?: number;
};

export function corpusPagesToSeedPages(
  pages: readonly SourceCorpusPage[],
  options?: Pick<
    ProfileIndexedSourceOptions,
    "maxSeedPages" | "maxMarkdownChars"
  >,
): SeedCatalogPage[] {
  return sourceCorpusPagesToProfileSeedPages(pages, {
    maxPages: options?.maxSeedPages,
    maxMarkdownChars: options?.maxMarkdownChars,
  });
}

function corpusRootUrl(corpus: SourceCorpusExport): string {
  const rootUrl =
    corpus.source.canonicalUrl ??
    corpus.source.startUrls[0] ??
    corpus.pages[0]?.url;
  if (!rootUrl) {
    throw new Error(
      `Indexed source "${corpus.source.slug}" has no URL available for profiling`,
    );
  }
  return rootUrl;
}

async function profileIndexedSourceWithResolved(
  sourceIdOrSlug: string,
  options: ProfileIndexedSourceOptions,
  resolved: ResolvedLedgeIndexOptions,
): Promise<CompanyProfileResult> {
  const corpus = await exportCorpus(sourceIdOrSlug, {
    includeContent: true,
    includeChunks: false,
  });
  const seedPages = corpusPagesToSeedPages(corpus.pages, options);
  if (seedPages.length === 0) {
    throw new Error(
      `Indexed source "${corpus.source.slug}" has no pages to profile`,
    );
  }

  const { maxSeedPages: _maxSeedPages, maxMarkdownChars: _maxMarkdownChars, ...profileOptions } =
    options;
  return profileWithResolvedOptions(
    corpusRootUrl(corpus),
    {
      ...profileOptions,
      lenses: ["docs_identity", "docs_topics"],
      seedPages,
    },
    resolved,
  );
}

export async function profileIndexedSource(
  sourceIdOrSlug: string,
  options: ProfileIndexedSourceOptions = {},
  initOptions?: LedgeIndexOptions,
): Promise<CompanyProfileResult> {
  return profileIndexedSourceWithResolved(
    sourceIdOrSlug,
    options,
    resolveOptions(initOptions ?? {}),
  );
}

export function profileIndexedSourceWithResolvedOptions(
  sourceIdOrSlug: string,
  options: ProfileIndexedSourceOptions,
  resolved: ResolvedLedgeIndexOptions,
): Promise<CompanyProfileResult> {
  return profileIndexedSourceWithResolved(sourceIdOrSlug, options, resolved);
}
