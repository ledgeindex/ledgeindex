import { readFileSync, writeFileSync } from "node:fs";
import type { WebCrawlSourceConfig } from "../schemas/source-config.js";
import { getDataDir, dataPath } from "../lib/data-dir.js";
import { MemoryStore } from "./memory-store.js";
import type {
  CrawlRun,
  CrawlRunKind,
  Project,
  Source,
  SourceSet,
  Store,
} from "./types.js";

type StoreSnapshot = {
  projects: Project[];
  sources: Source[];
  crawlRuns: CrawlRun[];
  sourceSets: SourceSet[];
};

const DEFAULT_FILE = dataPath("dev-store.json");

function loadSnapshot(filePath: string): StoreSnapshot | null {
  try {
    const raw = readFileSync(filePath, "utf8");
    return JSON.parse(raw) as StoreSnapshot;
  } catch {
    return null;
  }
}

function saveSnapshot(filePath: string, store: MemoryStore) {
  const snapshot: StoreSnapshot = {
    projects: [...store.listProjectsSnapshot()],
    sources: [...store.listSourcesSnapshot()],
    crawlRuns: [...store.listCrawlRuns()],
    sourceSets: [...store.listSourceSetsSnapshot()],
  };
  getDataDir();
  writeFileSync(filePath, JSON.stringify(snapshot, null, 2), "utf8");
}

/**
 * Dev fallback: same as MemoryStore but survives API restarts.
 */
export class FileStore implements Store {
  private readonly filePath: string;
  private readonly memory: MemoryStore;

  constructor(filePath = DEFAULT_FILE) {
    this.filePath = filePath;
    this.memory = new MemoryStore();
    const snapshot = loadSnapshot(filePath);
    if (snapshot) {
      this.memory.hydrate(snapshot);
    }
  }

  private persist() {
    saveSnapshot(this.filePath, this.memory);
  }

  async createProject(name: string, ownerUserId: string): Promise<Project> {
    const project = await this.memory.createProject(name, ownerUserId);
    this.persist();
    return project;
  }

  async getOrCreatePlatformProject(): Promise<Project> {
    const project = await this.memory.getOrCreatePlatformProject();
    this.persist();
    return project;
  }

  async getProject(id: string): Promise<Project | null> {
    return this.memory.getProject(id);
  }

  async listProjects(ownerUserId?: string): Promise<Project[]> {
    return this.memory.listProjects(ownerUserId);
  }

  async createSource(input: {
    projectId: string;
    name: string;
    slug?: string;
    slugOwnerKey: string;
    scope?: import("./types.js").SourceScope;
    config: WebCrawlSourceConfig;
    sourceMetadata?: import("../schemas/source-metadata.js").SourceMetadata | null;
    canonicalUrl?: string | null;
    sourceFamilyId?: string | null;
    versionNumber?: number;
    versionLabel?: string | null;
  }): Promise<Source> {
    const source = await this.memory.createSource(input);
    this.persist();
    return source;
  }

  async getSourceBySlug(slug: string, slugOwnerKey: string): Promise<Source | null> {
    return this.memory.getSourceBySlug(slug, slugOwnerKey);
  }

  async isSourceSlugTaken(
    slug: string,
    slugOwnerKey: string,
    excludeSourceId?: string,
  ): Promise<boolean> {
    return this.memory.isSourceSlugTaken(slug, slugOwnerKey, excludeSourceId);
  }

  async getSource(id: string): Promise<Source | null> {
    return this.memory.getSource(id);
  }

  async listSources(projectId?: string): Promise<Source[]> {
    return this.memory.listSources(projectId);
  }

  async listPersonalSourcesForOwner(ownerUserId: string): Promise<Source[]> {
    return this.memory.listPersonalSourcesForOwner(ownerUserId);
  }

  async listGlobalSources(): Promise<Source[]> {
    return this.memory.listGlobalSources();
  }

  async listSourcesByCanonicalUrl(
    canonicalUrl: string,
    scope: import("./types.js").SourceScope,
    slugOwnerKey: string,
  ): Promise<Source[]> {
    return this.memory.listSourcesByCanonicalUrl(canonicalUrl, scope, slugOwnerKey);
  }

  async listSourcesByFamilyId(sourceFamilyId: string): Promise<Source[]> {
    return this.memory.listSourcesByFamilyId(sourceFamilyId);
  }

  async listSourcesForOwner(ownerUserId: string): Promise<Source[]> {
    return this.memory.listSourcesForOwner(ownerUserId);
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
      sourceMetadata?: import("../schemas/source-metadata.js").SourceMetadata | null;
      indexedAt?: string | null;
      indexStats?: Source["indexStats"];
      canonicalUrl?: string | null;
      sourceFamilyId?: string | null;
      versionNumber?: number;
      versionLabel?: string | null;
      categories?: string[];
      displayOrder?: number | null;
    },
  ): Promise<Source | null> {
    const source = await this.memory.updateSource(id, input);
    if (source) this.persist();
    return source;
  }

  async deleteSource(id: string): Promise<boolean> {
    const deleted = await this.memory.deleteSource(id);
    if (deleted) this.persist();
    return deleted;
  }

  async createCrawlRun(input: {
    sourceId: string;
    kind: CrawlRunKind;
  }): Promise<CrawlRun> {
    const run = await this.memory.createCrawlRun(input);
    this.persist();
    return run;
  }

  async updateCrawlRun(
    id: string,
    input: Parameters<MemoryStore["updateCrawlRun"]>[1],
  ): Promise<CrawlRun | null> {
    const run = await this.memory.updateCrawlRun(id, input);
    if (run) this.persist();
    return run;
  }

  async getCrawlRun(id: string): Promise<CrawlRun | null> {
    return this.memory.getCrawlRun(id);
  }

  async createSourceSet(
    input: Parameters<MemoryStore["createSourceSet"]>[0],
  ): Promise<SourceSet> {
    const sourceSet = await this.memory.createSourceSet(input);
    this.persist();
    return sourceSet;
  }

  async getSourceSet(id: string): Promise<SourceSet | null> {
    return this.memory.getSourceSet(id);
  }

  async getSourceSetBySlug(
    ownerUserId: string,
    slug: string,
  ): Promise<SourceSet | null> {
    return this.memory.getSourceSetBySlug(ownerUserId, slug);
  }

  async listSourceSets(ownerUserId: string): Promise<SourceSet[]> {
    return this.memory.listSourceSets(ownerUserId);
  }

  async isSourceSetSlugTaken(
    ownerUserId: string,
    slug: string,
    excludeSourceSetId?: string,
  ): Promise<boolean> {
    return this.memory.isSourceSetSlugTaken(
      ownerUserId,
      slug,
      excludeSourceSetId,
    );
  }

  async updateSourceSet(
    id: string,
    input: Parameters<MemoryStore["updateSourceSet"]>[1],
  ): Promise<SourceSet | null> {
    const sourceSet = await this.memory.updateSourceSet(id, input);
    if (sourceSet) this.persist();
    return sourceSet;
  }

  async deleteSourceSet(id: string): Promise<boolean> {
    const deleted = await this.memory.deleteSourceSet(id);
    if (deleted) this.persist();
    return deleted;
  }
}
