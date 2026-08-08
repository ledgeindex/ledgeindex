import type { CompanyProfileResult } from "./research/run-company-profile.js";
import type { ResearchLens } from "./research/research-lenses.js";
import { pageMarkdownByUrlFromFetched } from "./research/enrich-package-usage-examples.js";
export type ProfileLensSourceEntry = {
  urls: string[];
  titles: string[];
  pickSummary?: string;
  /** Full page markdown keyed by fetched URL (same keys as urls where available). */
  pageMarkdownByUrl?: Record<string, string>;
};

export type ProfileLensSources = Partial<
  Record<ResearchLens, ProfileLensSourceEntry>
>;

/** URLs the model picked (and used) per research lens. */
export function buildProfileLensSources(
  result: CompanyProfileResult,
): ProfileLensSources {
  const out: ProfileLensSources = {};
  for (const run of result.runs) {
    const selected = run.pick.selected;
    if (selected.length === 0) continue;
    const titleByUrl = new Map(selected.map((p) => [p.url, p.title]));
    const urls =
      run.sourceUrls && run.sourceUrls.length > 0
        ? run.sourceUrls
        : run.synth?.sourceUrls && run.synth.sourceUrls.length > 0
          ? run.synth.sourceUrls
          : selected.map((p) => p.url);
    const titles = urls.map((url) => titleByUrl.get(url) ?? url);
    out[run.lens] = {
      urls,
      titles,
      ...(run.pick.summary?.trim()
        ? { pickSummary: run.pick.summary.trim() }
        : {}),
      ...(run.fetchedPages?.length
        ? { pageMarkdownByUrl: pageMarkdownByUrlFromFetched(run.fetchedPages) }
        : {}),
    };
  }
  return out;
}
