import { FileStore } from "./file-store.js";
import { MemoryStore } from "./memory-store.js";
import { createCloudReadPool, createPgPool, PgStore } from "./pg-store.js";
import type {
  CrawlRun,
  CrawlRunKind,
  Project,
  Source,
  SourceIndexStats,
  SourceMetadata,
  SourceScope,
  SourceSet,
  Store,
} from "./types.js";
import type { WebCrawlSourceConfig } from "../schemas/source-config.js";
import { logInfo } from "../lib/logger.js";

let store: Store | null = null;

/**
 * Local FileStore for personal/local data + cloud Postgres read-through for
 * **public/global** source writes when LEDGEINDEX_CLOUD_POSTGRES_URI is set (proxy).
 *
 * Just-me cloud and public/global **listing** use the hosted HTTP API from the
 * client when the active API is loopback — not this Postgres read-through.
 */
class LocalWithCloudGlobalStore implements Store {
  constructor(
    private readonly local: Store,
    private readonly cloud: PgStore,
  ) {}

  async getSource(id: string): Promise<Source | null> {
    const fromLocal = await this.local.getSource(id);
    if (fromLocal) return fromLocal;
    return this.cloud.getSource(id);
  }

  async listGlobalSources(): Promise<Source[]> {
    return this.cloud.listGlobalSources();
  }

  async listSources(projectId?: string): Promise<Source[]> {
    if (!projectId) {
      const [localSources, global] = await Promise.all([
        this.local.listSources(),
        this.listGlobalSources(),
      ]);
      const personal = localSources.filter((s) => s.scope !== "global");
      const byId = new Map<string, Source>();
      for (const s of [...personal, ...global]) byId.set(s.id, s);
      return [...byId.values()];
    }
    return this.local.listSources(projectId);
  }

  async getSourceBySlug(
    slug: string,
    slugOwnerKey: string,
  ): Promise<Source | null> {
    const fromLocal = await this.local.getSourceBySlug(slug, slugOwnerKey);
    if (fromLocal) return fromLocal;
    return this.cloud.getSourceBySlug(slug, slugOwnerKey);
  }

  async listSourcesByFamilyId(sourceFamilyId: string): Promise<Source[]> {
    const fromLocal = await this.local.listSourcesByFamilyId(sourceFamilyId);
    if (fromLocal.length > 0) return fromLocal;
    return this.cloud.listSourcesByFamilyId(sourceFamilyId);
  }

  async listSourcesByCanonicalUrl(
    canonicalUrl: string,
    scope: SourceScope,
    slugOwnerKey: string,
  ): Promise<Source[]> {
    if (scope === "global") {
      return this.cloud.listSourcesByCanonicalUrl(
        canonicalUrl,
        scope,
        slugOwnerKey,
      );
    }
    return this.local.listSourcesByCanonicalUrl(
      canonicalUrl,
      scope,
      slugOwnerKey,
    );
  }

  createProject(name: string, ownerUserId: string): Promise<Project> {
    return this.local.createProject(name, ownerUserId);
  }
  getOrCreatePlatformProject(): Promise<Project> {
    return this.local.getOrCreatePlatformProject();
  }
  getProject(id: string): Promise<Project | null> {
    return this.local.getProject(id);
  }
  listProjects(ownerUserId?: string): Promise<Project[]> {
    return this.local.listProjects(ownerUserId);
  }
  createSource(input: {
    projectId: string;
    name: string;
    slug?: string;
    slugOwnerKey: string;
    scope?: SourceScope;
    hosting?: import("./source-hosting.js").SourceHosting;
    config: WebCrawlSourceConfig;
    sourceMetadata?: SourceMetadata | null;
    canonicalUrl?: string | null;
    sourceFamilyId?: string | null;
    versionNumber?: number;
    versionLabel?: string | null;
  }): Promise<Source> {
    return this.local.createSource(input);
  }
  isSourceSlugTaken(
    slug: string,
    slugOwnerKey: string,
    excludeSourceId?: string,
  ): Promise<boolean> {
    return this.local.isSourceSlugTaken(slug, slugOwnerKey, excludeSourceId);
  }
  listPersonalSourcesForOwner(ownerUserId: string): Promise<Source[]> {
    return this.local.listPersonalSourcesForOwner(ownerUserId);
  }
  async updateSource(
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
      displayOrder?: number | null;
    },
  ): Promise<Source | null> {
    // Cloud-owned global sources: persist metadata (incl. categories) to cloud
    // so every local API can read the same shelves. Personal stays local-only.
    const localSource = await this.local.getSource(id);
    if (localSource) {
      return this.local.updateSource(id, input);
    }
    const cloudSource = await this.cloud.getSource(id);
    if (cloudSource) {
      return this.cloud.updateSource(id, input);
    }
    return null;
  }
  async deleteSource(id: string): Promise<boolean> {
    const localSource = await this.local.getSource(id);
    if (localSource) {
      return this.local.deleteSource(id);
    }
    return this.cloud.deleteSource(id);
  }
  createCrawlRun(input: {
    sourceId: string;
    kind: CrawlRunKind;
  }): Promise<CrawlRun> {
    return this.local.createCrawlRun(input);
  }
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
  ): Promise<CrawlRun | null> {
    return this.local.updateCrawlRun(id, input);
  }
  getCrawlRun(id: string): Promise<CrawlRun | null> {
    return this.local.getCrawlRun(id);
  }
  createSourceSet(input: {
    ownerUserId: string;
    name: string;
    slug: string;
    description?: string | null;
    sourceIds: string[];
  }): Promise<SourceSet> {
    return this.local.createSourceSet(input);
  }
  getSourceSet(id: string): Promise<SourceSet | null> {
    return this.local.getSourceSet(id);
  }
  getSourceSetBySlug(
    ownerUserId: string,
    slug: string,
  ): Promise<SourceSet | null> {
    return this.local.getSourceSetBySlug(ownerUserId, slug);
  }
  listSourceSets(ownerUserId: string): Promise<SourceSet[]> {
    return this.local.listSourceSets(ownerUserId);
  }
  isSourceSetSlugTaken(
    ownerUserId: string,
    slug: string,
    excludeSourceSetId?: string,
  ): Promise<boolean> {
    return this.local.isSourceSetSlugTaken(
      ownerUserId,
      slug,
      excludeSourceSetId,
    );
  }
  updateSourceSet(
    id: string,
    input: {
      name?: string;
      slug?: string;
      description?: string | null;
      sourceIds?: string[];
    },
  ): Promise<SourceSet | null> {
    return this.local.updateSourceSet(id, input);
  }
  deleteSourceSet(id: string): Promise<boolean> {
    return this.local.deleteSourceSet(id);
  }
}

export function getStore(): Store {
  if (store) return store;

  const writablePool = createPgPool();
  if (writablePool) {
    store = new PgStore(writablePool);
    return store;
  }

  const useMemoryOnly = process.env.LEDGEINDEX_MEMORY_STORE === "1";
  const local: Store = useMemoryOnly ? new MemoryStore() : new FileStore();

  const cloudPool = createCloudReadPool();
  if (cloudPool) {
    logInfo(
      "Local metadata + cloud global source read-through (LEDGEINDEX_CLOUD_POSTGRES_URI)",
      "Store",
    );
    store = new LocalWithCloudGlobalStore(local, new PgStore(cloudPool));
    return store;
  }

  store = local;
  return store;
}
