import type { WebCrawlSourceConfig } from "../schemas/source-config.js";
import type { SourceMetadata } from "../schemas/source-metadata.js";
import type { SourceHosting } from "./source-hosting.js";

export type { SourceMetadata };

export type SourceScope = "personal" | "global";

export type { SourceHosting } from "./source-hosting.js";
export {
  defaultHostingForScope,
  isLocalHostingDeployment,
  isSourceHosting,
  normalizeCreateHosting,
  resolveSourceHosting,
} from "./source-hosting.js";

export const PLATFORM_PROJECT_NAME = "LedgeIndex Platform";
export type CrawlRunStatus = "pending" | "running" | "completed" | "failed";
export type CrawlRunKind = "preview" | "full" | "refresh";

export type CrawlRunResult = {
  urls?: { url: string; title?: string }[];
  skipped?: { url: string; reason: string }[];
};

export type Project = {
  id: string;
  name: string;
  ownerUserId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SourceIndexStats = {
  pageCount: number;
  chunkCount: number;
  vectorBackend?: string;
};

export type Source = {
  id: string;
  projectId: string;
  name: string;
  slug: string;
  type: "web_crawl";
  scope: SourceScope;
  /** local FileStore/LibSQL vs cloud Postgres/pgvector — independent of personal/public. */
  hosting: SourceHosting;
  config: WebCrawlSourceConfig;
  ogImageUrl?: string | null;
  faviconUrl?: string | null;
  sourceMetadata?: SourceMetadata | null;
  indexedAt?: string | null;
  indexStats?: SourceIndexStats | null;
  canonicalUrl?: string | null;
  sourceFamilyId?: string | null;
  versionNumber?: number;
  versionLabel?: string | null;
  categories?: string[];
  createdAt: string;
  updatedAt: string;
};

export type SourceVersionSummary = {
  id: string;
  versionNumber: number;
  versionLabel: string;
  indexedAt: string | null;
  chunkCount: number;
  pageCount: number;
};

export type SourceSummary = {
  id: string;
  projectId: string;
  name: string;
  slug: string;
  scope: SourceScope;
  hosting: SourceHosting;
  startUrl: string;
  /** All crawl roots for this set (startUrl is the first). */
  startUrls: string[];
  ogImageUrl: string | null;
  faviconUrl: string | null;
  indexedAt: string | null;
  pageCount: number;
  chunkCount: number;
  canonicalUrl: string | null;
  sourceFamilyId: string;
  versionNumber: number;
  versionLabel: string;
  categories: string[];
  versions: SourceVersionSummary[];
  /** Crawl URL exclude patterns saved on the source (applied on refresh). */
  excludePatterns: string[];
  /** Crawl URL include patterns saved on the source. */
  includePatterns: string[];
};

export type SourceSet = {
  id: string;
  ownerUserId: string;
  name: string;
  slug: string;
  description: string | null;
  sourceIds: string[];
  createdAt: string;
  updatedAt: string;
};

export type SourceSetSummary = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  sourceCount: number;
  sources: Array<{
    id: string;
    slug: string;
    name: string;
    scope: SourceScope;
  }>;
};

export type CrawlRun = {
  id: string;
  sourceId: string;
  kind: CrawlRunKind;
  status: CrawlRunStatus;
  pagesDiscovered: number;
  pagesProcessed: number;
  error: string | null;
  result: CrawlRunResult;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
};

export interface Store {
  createProject(name: string, ownerUserId: string): Promise<Project>;
  getOrCreatePlatformProject(): Promise<Project>;
  getProject(id: string): Promise<Project | null>;
  listProjects(ownerUserId?: string): Promise<Project[]>;

  createSource(input: {
    projectId: string;
    name: string;
    slug?: string;
    slugOwnerKey: string;
    scope?: SourceScope;
    hosting?: SourceHosting;
    config: WebCrawlSourceConfig;
    sourceMetadata?: SourceMetadata | null;
    canonicalUrl?: string | null;
    sourceFamilyId?: string | null;
    versionNumber?: number;
    versionLabel?: string | null;
  }): Promise<Source>;
  getSource(id: string): Promise<Source | null>;
  getSourceBySlug(slug: string, slugOwnerKey: string): Promise<Source | null>;
  isSourceSlugTaken(slug: string, slugOwnerKey: string, excludeSourceId?: string): Promise<boolean>;
  listSources(projectId?: string): Promise<Source[]>;
  listPersonalSourcesForOwner(ownerUserId: string): Promise<Source[]>;
  listGlobalSources(): Promise<Source[]>;
  listSourcesByCanonicalUrl(
    canonicalUrl: string,
    scope: SourceScope,
    slugOwnerKey: string,
  ): Promise<Source[]>;
  listSourcesByFamilyId(sourceFamilyId: string): Promise<Source[]>;
  updateSource(
    id: string,
    input: {
      name?: string;
      slug?: string;
      slugOwnerKey?: string;
      config?: WebCrawlSourceConfig;
      ogImageUrl?: string | null;
      faviconUrl?: string | null;
      sourceMetadata?: SourceMetadata | null;
      indexedAt?: string | null;
      indexStats?: SourceIndexStats | null;
      canonicalUrl?: string | null;
      sourceFamilyId?: string | null;
      versionNumber?: number;
      versionLabel?: string | null;
      categories?: string[];
    },
  ): Promise<Source | null>;

  deleteSource(id: string): Promise<boolean>;

  createCrawlRun(input: {
    sourceId: string;
    kind: CrawlRunKind;
  }): Promise<CrawlRun>;
  updateCrawlRun(
    id: string,
    input: Partial<
      Pick<
        CrawlRun,
        | "status"
        | "pagesDiscovered"
        | "pagesProcessed"
        | "error"
        | "result"
        | "startedAt"
        | "finishedAt"
      >
    >,
  ): Promise<CrawlRun | null>;
  getCrawlRun(id: string): Promise<CrawlRun | null>;

  createSourceSet(input: {
    ownerUserId: string;
    name: string;
    slug: string;
    description?: string | null;
    sourceIds: string[];
  }): Promise<SourceSet>;
  getSourceSet(id: string): Promise<SourceSet | null>;
  getSourceSetBySlug(ownerUserId: string, slug: string): Promise<SourceSet | null>;
  listSourceSets(ownerUserId: string): Promise<SourceSet[]>;
  isSourceSetSlugTaken(
    ownerUserId: string,
    slug: string,
    excludeSourceSetId?: string,
  ): Promise<boolean>;
  updateSourceSet(
    id: string,
    input: {
      name?: string;
      slug?: string;
      description?: string | null;
      sourceIds?: string[];
    },
  ): Promise<SourceSet | null>;
  deleteSourceSet(id: string): Promise<boolean>;
}
