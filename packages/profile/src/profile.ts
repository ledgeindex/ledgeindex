import {
  runCompanyProfile,
  type CompanyProfileProgress,
  type CompanyProfileResult,
  type SeedCatalogPage,
} from "./research/run-company-profile.js";
import type { ProfileModelSelection } from "./research/profile-model.js";
import {
  defaultProfileLenses,
  type ResearchLens,
} from "./research/research-lenses.js";

export type ProfileOptions = {
  modelId?: string;
  model?: ProfileModelSelection | null;
  maxPages?: number;
  sitemapOnly?: boolean;
  /** Pick URLs per lens only; skip fetch and structured synth */
  pickOnly?: boolean;
  /** Skip crawl; pick from these pages (optional markdown skips HTTP fetch). */
  seedPages?: SeedCatalogPage[];
  onLensStart?: (lens: ResearchLens, index: number, total: number) => void;
  onProgress?: (progress: CompanyProfileProgress) => void;
};

/**
 * Site research profile: crawl once, then run each lens (pick → fetch → structured output).
 * Pass `seedPages` to skip crawl (e.g. source builder content).
 *
 * @example
 * const { profile } = await profileSite("https://kapa.ai/", ["capabilities"]);
 * const features = profile.capabilities;
 */
export async function profileSite(
  url: string,
  modes: ResearchLens[] = defaultProfileLenses(),
  options?: ProfileOptions,
): Promise<CompanyProfileResult> {
  if (modes.length === 0) {
    throw new Error("modes must include at least one research lens");
  }

  return runCompanyProfile({
    rootUrl: url,
    lenses: modes,
    modelId: options?.modelId,
    model: options?.model,
    maxPages: options?.maxPages,
    sitemapOnly: options?.sitemapOnly,
    pickOnly: options?.pickOnly,
    seedPages: options?.seedPages,
    onLensStart: options?.onLensStart,
    onProgress: options?.onProgress,
  });
}

/** @alias profileSite */
export const profile = profileSite;
