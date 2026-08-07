import { randomUUID } from "node:crypto";
import { profileSite } from "./profile.js";
import { buildProfileLensSources, type ProfileLensSources } from "./profile-lens-sources.js";
import type { ProfileModelSelection } from "./research/profile-model.js";
import type { SeedCatalogPage } from "./research/run-company-profile.js";
import type { CompanyProfileData, ResearchLens } from "./research/research-lenses.js";

export type SiteProfileRunStatus = "running" | "completed" | "failed";

export type SiteProfileRunPhase = "crawl" | "pick" | "fetch" | "synthesize";

export type ProfileSiteRunProgress = {
  phase: "crawl" | "pick" | "fetch" | "synthesize";
  lens?: ResearchLens;
  index?: number;
  total?: number;
  subphase?: "inventory" | "examples";
  primitiveName?: string;
};

export type SiteProfileRun = {
  id: string;
  rootUrl: string;
  lenses: ResearchLens[];
  status: SiteProfileRunStatus;
  createdAt: string;
  completedAt?: string;
  error?: string;
  progress?: ProfileSiteRunProgress;
  profile?: CompanyProfileData;
  /** Per-lens pages selected by the catalog picker and used for synthesis. */
  lensSources?: ProfileLensSources;
  modelId?: string;
  crawlPageCount?: number;
};

const runs = new Map<string, SiteProfileRun>();

export function getSiteProfileRun(id: string): SiteProfileRun | null {
  return runs.get(id) ?? null;
}

export function startSiteProfileRun(input: {
  rootUrl: string;
  lenses: ResearchLens[];
  maxPages?: number;
  sitemapOnly?: boolean;
  model?: ProfileModelSelection | null;
  /** Skip crawl; pick from these pages (markdown skips fetch). */
  seedPages?: SeedCatalogPage[];
}): SiteProfileRun {
  const id = randomUUID();
  const run: SiteProfileRun = {
    id,
    rootUrl: input.rootUrl.trim(),
    lenses: input.lenses,
    status: "running",
    createdAt: new Date().toISOString(),
    ...(input.seedPages?.length
      ? { progress: { phase: "pick" as const } }
      : {}),
  };
  runs.set(id, run);

  void (async () => {
    try {
      const result = await profileSite(input.rootUrl, input.lenses, {
        maxPages: input.maxPages,
        sitemapOnly: input.sitemapOnly,
        model: input.model,
        seedPages: input.seedPages,
        onProgress: (progress) => {
          const current = runs.get(id);
          if (!current || current.status !== "running") return;
          current.progress = progress;
        },
      });
      const current = runs.get(id);
      if (!current) return;
      current.status = "completed";
      current.completedAt = new Date().toISOString();
      current.profile = result.profile;
      current.lensSources = buildProfileLensSources(result);
      current.modelId = result.modelId;
      current.crawlPageCount = result.crawl.pages.length;
      delete current.progress;
    } catch (error) {
      const current = runs.get(id);
      if (!current) return;
      current.status = "failed";
      current.completedAt = new Date().toISOString();
      current.error = error instanceof Error ? error.message : String(error);
      delete current.progress;
    }
  })();

  return { ...run };
}
