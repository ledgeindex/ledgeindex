import {
  crawlSiteCatalog,
  pickCatalogForLens,
  type CatalogPickResult,
  type CrawlSiteCatalogResult,
  type SiteCatalogPage,
} from "./crawl-catalog.js";
import { fetchPickedPages } from "./fetch-picked-pages.js";
import type { ProfileModelSelection } from "./profile-model.js";
import { resolveProfileStepModel } from "./profile-model.js";
import {
  resolveProfileLenses,
  type CompanyProfileData,
  type LensOutputById,
  type ResearchLens,
} from "./research-lenses.js";
import { synthesizeLens, type SynthesizeLensResult } from "./synthesize-lens.js";
import { runPackagePrimitivesUsageProfile } from "./run-package-primitives-usage-profile.js";
import { runPackageUsageExamplesProfile } from "./run-package-usage-examples-profile.js";
import type { FetchedPage } from "./fetch-picked-pages.js";

export type CompanyProfileLensRun = {
  lens: ResearchLens;
  pick: CatalogPickResult;
  fetchedPageCount: number;
  synth?: SynthesizeLensResult;
  /** Markdown fetched for picked URLs (for lens source export). */
  fetchedPages?: FetchedPage[];
  /** All URLs used when a lens runs multi-phase picks (e.g. package primitives). */
  sourceUrls?: string[];
};

export type CompanyProfileProgress = {
  phase: "crawl" | "pick" | "fetch" | "synthesize";
  lens?: ResearchLens;
  index?: number;
  total?: number;
  subphase?: "inventory" | "examples";
  primitiveName?: string;
};

export type CompanyProfileResult = {
  rootUrl: string;
  modelId: string;
  crawl: CrawlSiteCatalogResult;
  lenses: ResearchLens[];
  runs: CompanyProfileLensRun[];
  /** Merged structured output per lens — ready for compare matrix / export */
  profile: CompanyProfileData;
};

/** Pre-built catalog page. When `markdown` is set, HTTP fetch is skipped for that URL. */
export type SeedCatalogPage = {
  url: string;
  title: string;
  markdown?: string;
};

export type RunCompanyProfileInput = {
  rootUrl: string;
  /** Subset of lenses; default = all seven */
  lenses?: ResearchLens[];
  modelId?: string;
  /** api / lm-studio / ag-native — same as docs enrich. */
  model?: ProfileModelSelection | null;
  maxPages?: number;
  sitemapOnly?: boolean;
  /** Pick + count only; skip fetch and structured synth */
  pickOnly?: boolean;
  /**
   * When set, skip site crawl and use these pages as the pick catalog.
   * Markdown (when present) is used instead of fetching the URL.
   */
  seedPages?: SeedCatalogPage[];
  /** Optional user guidance for page selection and profile synthesis. */
  hint?: string;
  onLensStart?: (lens: ResearchLens, index: number, total: number) => void;
  onProgress?: (progress: CompanyProfileProgress) => void;
};

function fetchedFromSeed(
  picked: SiteCatalogPage[],
  markdownByUrl: Map<string, string>,
): FetchedPage[] {
  return picked.map((page) => {
    const markdown = (markdownByUrl.get(page.url) ?? "").trim();
    return {
      url: page.url,
      title: page.title,
      markdownChars: markdown.length,
      markdown,
      ...(markdown ? {} : { error: "No seed markdown for page" }),
    };
  });
}

function setProfileLens<K extends ResearchLens>(
  profile: CompanyProfileData,
  lens: K,
  data: LensOutputById[K],
): void {
  profile[lens] = data;
}

/**
 * One crawl, then each lens sequentially: pick → fetch → structured synthesize.
 * Complete / profile mode merges lens outputs into `profile`.
 */
export async function runCompanyProfile(
  input: RunCompanyProfileInput,
): Promise<CompanyProfileResult> {
  const lenses = resolveProfileLenses(input.lenses);
  const modelOpts = { modelId: input.modelId, model: input.model };
  const { modelId } = await resolveProfileStepModel(modelOpts);

  const seedPages = input.seedPages?.filter((page) => page.url.trim()) ?? [];
  const seedMarkdownByUrl = new Map<string, string>();
  for (const page of seedPages) {
    if (typeof page.markdown === "string" && page.markdown.trim()) {
      seedMarkdownByUrl.set(page.url, page.markdown);
    }
  }
  const useSeedCatalog = seedPages.length > 0;

  let crawl: CrawlSiteCatalogResult;
  if (useSeedCatalog) {
    // Builder / pre-indexed sources: pick + profile without a live crawl.
    const rootUrl = input.rootUrl.trim().endsWith("/")
      ? input.rootUrl.trim()
      : `${input.rootUrl.trim()}/`;
    crawl = {
      rootUrl,
      urlCount: seedPages.length,
      skippedCount: 0,
      pages: seedPages.map((page) => ({
        url: page.url,
        title: page.title?.trim() || page.url,
      })),
    };
  } else {
    input.onProgress?.({ phase: "crawl" });
    crawl = await crawlSiteCatalog({
      rootUrl: input.rootUrl,
      maxPages: input.maxPages,
      sitemapOnly: input.sitemapOnly,
    });
  }

  const runs: CompanyProfileLensRun[] = [];
  const profile: CompanyProfileData = {};

  for (let i = 0; i < lenses.length; i++) {
    const lens = lenses[i]!;
    input.onLensStart?.(lens, i, lenses.length);
    input.onProgress?.({
      phase: "pick",
      lens,
      index: i,
      total: lenses.length,
    });

    if (lens === "package_primitives_usage") {
      const twoStep = await runPackagePrimitivesUsageProfile({
        catalog: crawl.pages,
        rootUrl: crawl.rootUrl,
        ...modelOpts,
        pickOnly: input.pickOnly,
        lensIndex: i,
        lensTotal: lenses.length,
        onProgress: (p) => input.onProgress?.(p),
      });
      setProfileLens(profile, lens, twoStep.data);
      runs.push(twoStep.lensRun);
      continue;
    }

    if (lens === "package_usage_examples") {
      const twoStep = await runPackageUsageExamplesProfile({
        catalog: crawl.pages,
        rootUrl: crawl.rootUrl,
        ...modelOpts,
        pickOnly: input.pickOnly,
        lensIndex: i,
        lensTotal: lenses.length,
        onProgress: (p) => input.onProgress?.(p),
      });
      setProfileLens(profile, lens, twoStep.data);
      runs.push(twoStep.lensRun);
      continue;
    }

    const pick = await pickCatalogForLens(crawl.pages, lens, {
      ...modelOpts,
      rootUrl: crawl.rootUrl,
      hint: input.hint,
    });

    if (pick.selected.length === 0) {
      runs.push({ lens, pick, fetchedPageCount: 0 });
      continue;
    }

    if (input.pickOnly) {
      runs.push({ lens, pick, fetchedPageCount: 0 });
      continue;
    }

    input.onProgress?.({
      phase: "fetch",
      lens,
      index: i,
      total: lenses.length,
    });

    const allSeeded = pick.selected.every((page) =>
      seedMarkdownByUrl.has(page.url),
    );
    const fetchedPages = allSeeded
      ? fetchedFromSeed(pick.selected, seedMarkdownByUrl)
      : (await fetchPickedPages(pick.selected, { modelId })).pages;

    input.onProgress?.({
      phase: "synthesize",
      lens,
      index: i,
      total: lenses.length,
    });
    const synth = await synthesizeLens(lens, fetchedPages, {
      ...modelOpts,
      hint: input.hint,
    });

    setProfileLens(profile, lens, synth.data);
    runs.push({
      lens,
      pick,
      fetchedPageCount: fetchedPages.length,
      synth,
      fetchedPages,
    });
  }

  return {
    rootUrl: crawl.rootUrl,
    modelId,
    crawl,
    lenses,
    runs,
    profile,
  };
}
