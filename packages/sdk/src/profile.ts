import {
  defaultProfileLenses,
  profileSite,
  type CompanyProfileProgress,
  type CompanyProfileResult,
  type ProfileOptions,
  type ResearchLens,
} from "@ledgeindex/profile";
import {
  applyOptionsToProcessEnv,
  assertChatModelAvailable,
  resolveOptions,
} from "./resolve-options.js";
import type { LedgeIndexOptions, ResolvedLedgeIndexOptions } from "./types.js";

export type LedgeIndexProfileOptions = ProfileOptions & {
  /** Research lenses to run. Default: all 14. */
  lenses?: ResearchLens[];
};

function runProfileWithResolved(
  url: string,
  options: LedgeIndexProfileOptions,
  resolved: ResolvedLedgeIndexOptions,
): Promise<CompanyProfileResult> {
  assertChatModelAvailable(resolved, "profile");
  applyOptionsToProcessEnv(resolved);

  const { lenses, ...profileOpts } = options;
  const modes = lenses ?? defaultProfileLenses();

  return profileSite(url, modes, profileOpts);
}

/**
 * Site research profile in-process — crawl once, then run each lens (pick → fetch → synth).
 * Does not require `initRuntime` / docs Mastra (unlike crawl/ask).
 */
export async function runProfile(
  url: string,
  options: LedgeIndexProfileOptions = {},
  initOptions?: LedgeIndexOptions,
): Promise<CompanyProfileResult> {
  const resolved = resolveOptions(initOptions ?? {});
  return runProfileWithResolved(url, options, resolved);
}

export function profileWithResolvedOptions(
  url: string,
  options: LedgeIndexProfileOptions,
  resolved: ResolvedLedgeIndexOptions,
): Promise<CompanyProfileResult> {
  return runProfileWithResolved(url, options, resolved);
}

export type { CompanyProfileProgress, CompanyProfileResult, ResearchLens };
export {
  defaultProfileLenses,
  parseResearchLensList,
  researchLensIds,
  getLensDefinition,
} from "@ledgeindex/profile";
