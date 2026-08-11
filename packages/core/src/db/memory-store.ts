import { randomUUID } from "node:crypto";
import type { WebCrawlSourceConfig } from "../schemas/source-config.js";
import type { SourceMetadata } from "../schemas/source-metadata.js";
import {
  ensureUniqueSourceSlug,
  globalSlugOwnerKey,
  slugifySourceName,
} from "../lib/source-slug.js";
import type {
  CrawlRun,
  CrawlRunKind,
  Project,
  Source,
  SourceHosting,
  SourceScope,
  SourceSet,
  Store,
} from "./types.js";
import { PLATFORM_PROJECT_NAME, resolveSourceHosting } from "./types.js";

function now() {
  return new Date().toISOString();
}

export class MemoryStore implements Store {
  private projects = new Map<string, Project>();
  private sources = new Map<string, Source>();
  private crawlRuns = new Map<string, CrawlRun>();
  private sourceSets = new Map<string, SourceSet>();

  private withHosting(source: Source): Source {
    return {
      ...source,
      hosting: resolveSourceHosting({
        hosting: source.hosting,
        scope: source.scope,
        vectorBackend: source.indexStats?.vectorBackend,
      }),
    };
  }

  async createProject(name: string, ownerUserId: string): Promise<Project> {
    const timestamp = now();
    const project: Project = {
      id: randomUUID(),
      name,
      ownerUserId,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.projects.set(project.id, project);
    return project;
  }

  async getOrCreatePlatformProject(): Promise<Project> {
    const existing = [...this.projects.values()].find(
      (project) =>
        project.ownerUserId === null &&
        project.name === PLATFORM_PROJECT_NAME,
    );
    if (existing) return existing;

    const timestamp = now();
    const project: Project = {
      id: randomUUID(),
      name: PLATFORM_PROJECT_NAME,
      ownerUserId: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.projects.set(project.id, project);
    return project;
  }

  async getProject(id: string): Promise<Project | null> {
    return this.projects.get(id) ?? null;
  }

  async listProjects(ownerUserId?: string): Promise<Project[]> {
    const projects = [...this.projects.values()];
    const filtered = ownerUserId
      ? projects.filter((project) => project.ownerUserId === ownerUserId)
      : projects;
    return filtered.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async createSource(input: {
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
    categories?: string[];
  }): Promise<Source> {
    const timestamp = now();
    const slug = await ensureUniqueSourceSlug(
      input.slug ?? slugifySourceName(input.name),
      input.slugOwnerKey,
      async (candidate, ownerKey) => this.isSourceSlugTaken(candidate, ownerKey),
    );
    const id = randomUUID();
    const scope = input.scope ?? "personal";
    const source: Source = {
      id,
      projectId: input.projectId,
      name: input.name,
      slug,
      type: "web_crawl",
      scope,
      hosting: resolveSourceHosting({
        hosting: input.hosting,
        scope,
      }),
      config: input.config,
      sourceMetadata: input.sourceMetadata ?? null,
      canonicalUrl: input.canonicalUrl ?? null,
      sourceFamilyId: input.sourceFamilyId ?? id,
      versionNumber: input.versionNumber ?? 1,
      versionLabel: input.versionLabel ?? null,
      categories: input.categories ?? [],
      displayOrder: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.sources.set(source.id, source);
    return source;
  }

  async getSourceBySlug(slug: string, slugOwnerKey: string): Promise<Source | null> {
    const normalized = slug.trim().toLowerCase();
    for (const source of this.sources.values()) {
      if (source.slug === normalized) {
        const ownerKey =
          source.scope === "global"
            ? globalSlugOwnerKey()
            : (this.projects.get(source.projectId)?.ownerUserId ?? "");
        if (ownerKey === slugOwnerKey) return this.withHosting(source);
      }
    }
    return null;
  }

  async isSourceSlugTaken(
    slug: string,
    slugOwnerKey: string,
    excludeSourceId?: string,
  ): Promise<boolean> {
    const existing = await this.getSourceBySlug(slug, slugOwnerKey);
    if (!existing) return false;
    if (excludeSourceId && existing.id === excludeSourceId) return false;
    return true;
  }

  async getSource(id: string): Promise<Source | null> {
    const source = this.sources.get(id);
    return source ? this.withHosting(source) : null;
  }

  async listSources(projectId?: string): Promise<Source[]> {
    const sources = [...this.sources.values()];
    const filtered = projectId
      ? sources.filter((source) => source.projectId === projectId)
      : sources;
    return filtered
      .map((source) => this.withHosting(source))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async listPersonalSourcesForOwner(ownerUserId: string): Promise<Source[]> {
    const ownedProjectIds = new Set(
      [...this.projects.values()]
        .filter((project) => project.ownerUserId === ownerUserId)
        .map((project) => project.id),
    );
    return [...this.sources.values()]
      .filter(
        (source) =>
          source.scope !== "global" && ownedProjectIds.has(source.projectId),
      )
      .map((source) => this.withHosting(source))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async listGlobalSources(): Promise<Source[]> {
    return [...this.sources.values()]
      .filter((source) => source.scope === "global")
      .map((source) => this.withHosting(source))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async listSourcesByCanonicalUrl(
    canonicalUrl: string,
    scope: SourceScope,
    slugOwnerKey: string,
  ): Promise<Source[]> {
    return [...this.sources.values()]
      .filter((source) => {
        if (source.canonicalUrl !== canonicalUrl) return false;
        if ((source.scope ?? "personal") !== scope) return false;
        const ownerKey =
          source.scope === "global"
            ? globalSlugOwnerKey()
            : (this.projects.get(source.projectId)?.ownerUserId ?? "");
        return ownerKey === slugOwnerKey;
      })
      .sort((a, b) => (b.versionNumber ?? 1) - (a.versionNumber ?? 1));
  }

  async listSourcesByFamilyId(sourceFamilyId: string): Promise<Source[]> {
    return [...this.sources.values()]
      .filter((source) => (source.sourceFamilyId ?? source.id) === sourceFamilyId)
      .sort((a, b) => (b.versionNumber ?? 1) - (a.versionNumber ?? 1));
  }

  /** @deprecated Use listPersonalSourcesForOwner */
  async listSourcesForOwner(ownerUserId: string): Promise<Source[]> {
    return this.listPersonalSourcesForOwner(ownerUserId);
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
      indexStats?: Source["indexStats"];
      canonicalUrl?: string | null;
      sourceFamilyId?: string | null;
      versionNumber?: number;
      versionLabel?: string | null;
      categories?: string[];
      displayOrder?: number | null;
    },
  ): Promise<Source | null> {
    const existing = this.sources.get(id);
    if (!existing) return null;

    const ownerKey =
      input.slugOwnerKey ??
      (existing.scope === "global"
        ? globalSlugOwnerKey()
        : (this.projects.get(existing.projectId)?.ownerUserId ?? ""));

    let slug = existing.slug;
    if (input.slug !== undefined) {
      slug = await ensureUniqueSourceSlug(input.slug, ownerKey, async (candidate, key) =>
        this.isSourceSlugTaken(candidate, key, id),
      );
    } else if (input.name && input.name !== existing.name && !existing.slug) {
      slug = await ensureUniqueSourceSlug(
        slugifySourceName(input.name),
        ownerKey,
        async (candidate, key) => this.isSourceSlugTaken(candidate, key, id),
      );
    }

    const updated: Source = {
      ...existing,
      name: input.name ?? existing.name,
      slug,
      config: input.config ?? existing.config,
      ogImageUrl:
        input.ogImageUrl !== undefined ? input.ogImageUrl : existing.ogImageUrl,
      faviconUrl:
        input.faviconUrl !== undefined ? input.faviconUrl : existing.faviconUrl,
      sourceMetadata:
        input.sourceMetadata !== undefined
          ? input.sourceMetadata
          : existing.sourceMetadata,
      indexedAt:
        input.indexedAt !== undefined ? input.indexedAt : existing.indexedAt,
      indexStats:
        input.indexStats !== undefined ? input.indexStats : existing.indexStats,
      canonicalUrl:
        input.canonicalUrl !== undefined ? input.canonicalUrl : existing.canonicalUrl,
      sourceFamilyId:
        input.sourceFamilyId !== undefined ? input.sourceFamilyId : existing.sourceFamilyId,
      versionNumber:
        input.versionNumber !== undefined ? input.versionNumber : existing.versionNumber,
      versionLabel:
        input.versionLabel !== undefined ? input.versionLabel : existing.versionLabel,
      categories:
        input.categories !== undefined ? input.categories : (existing.categories ?? []),
      displayOrder:
        input.displayOrder !== undefined
          ? input.displayOrder
          : (existing.displayOrder ?? null),
      updatedAt: now(),
    };
    this.sources.set(id, updated);
    return updated;
  }

  async deleteSource(id: string): Promise<boolean> {
    if (!this.sources.has(id)) return false;
    this.sources.delete(id);
    for (const [runId, run] of this.crawlRuns) {
      if (run.sourceId === id) {
        this.crawlRuns.delete(runId);
      }
    }
    return true;
  }

  async createCrawlRun(input: {
    sourceId: string;
    kind: CrawlRunKind;
  }): Promise<CrawlRun> {
    const timestamp = now();
    const run: CrawlRun = {
      id: randomUUID(),
      sourceId: input.sourceId,
      kind: input.kind,
      status: "pending",
      pagesDiscovered: 0,
      pagesProcessed: 0,
      error: null,
      result: {},
      startedAt: null,
      finishedAt: null,
      createdAt: timestamp,
    };
    this.crawlRuns.set(run.id, run);
    return run;
  }

  async updateCrawlRun(
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
    const existing = this.crawlRuns.get(id);
    if (!existing) return null;

    const updated: CrawlRun = {
      ...existing,
      ...input,
      result: input.result ?? existing.result,
    };
    this.crawlRuns.set(id, updated);
    return updated;
  }

  async getCrawlRun(id: string): Promise<CrawlRun | null> {
    return this.crawlRuns.get(id) ?? null;
  }

  async createSourceSet(input: {
    ownerUserId: string;
    name: string;
    slug: string;
    description?: string | null;
    sourceIds: string[];
  }): Promise<SourceSet> {
    const timestamp = now();
    const slug = await ensureUniqueSourceSlug(
      input.slug,
      input.ownerUserId,
      async (candidate, ownerKey) => this.isSourceSetSlugTaken(ownerKey, candidate),
    );
    const sourceSet: SourceSet = {
      id: randomUUID(),
      ownerUserId: input.ownerUserId,
      name: input.name,
      slug,
      description: input.description ?? null,
      sourceIds: [...input.sourceIds],
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.sourceSets.set(sourceSet.id, sourceSet);
    return sourceSet;
  }

  async getSourceSet(id: string): Promise<SourceSet | null> {
    return this.sourceSets.get(id) ?? null;
  }

  async getSourceSetBySlug(
    ownerUserId: string,
    slug: string,
  ): Promise<SourceSet | null> {
    const normalized = slug.trim().toLowerCase();
    for (const sourceSet of this.sourceSets.values()) {
      if (
        sourceSet.ownerUserId === ownerUserId &&
        sourceSet.slug === normalized
      ) {
        return sourceSet;
      }
    }
    return null;
  }

  async listSourceSets(ownerUserId: string): Promise<SourceSet[]> {
    return [...this.sourceSets.values()]
      .filter((sourceSet) => sourceSet.ownerUserId === ownerUserId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async isSourceSetSlugTaken(
    ownerUserId: string,
    slug: string,
    excludeSourceSetId?: string,
  ): Promise<boolean> {
    const existing = await this.getSourceSetBySlug(ownerUserId, slug);
    if (!existing) return false;
    if (excludeSourceSetId && existing.id === excludeSourceSetId) return false;
    return true;
  }

  async updateSourceSet(
    id: string,
    input: {
      name?: string;
      slug?: string;
      description?: string | null;
      sourceIds?: string[];
    },
  ): Promise<SourceSet | null> {
    const existing = this.sourceSets.get(id);
    if (!existing) return null;

    let slug = existing.slug;
    if (input.slug !== undefined) {
      slug = await ensureUniqueSourceSlug(
        input.slug,
        existing.ownerUserId,
        async (candidate, ownerKey) =>
          this.isSourceSetSlugTaken(ownerKey, candidate, id),
      );
    }

    const updated: SourceSet = {
      ...existing,
      name: input.name ?? existing.name,
      slug,
      description:
        input.description !== undefined
          ? input.description
          : existing.description,
      sourceIds:
        input.sourceIds !== undefined
          ? [...input.sourceIds]
          : existing.sourceIds,
      updatedAt: now(),
    };
    this.sourceSets.set(id, updated);
    return updated;
  }

  async deleteSourceSet(id: string): Promise<boolean> {
    return this.sourceSets.delete(id);
  }

  listProjectsSnapshot(): Project[] {
    return [...this.projects.values()];
  }

  listSourcesSnapshot(): Source[] {
    return [...this.sources.values()];
  }

  listCrawlRuns(): CrawlRun[] {
    return [...this.crawlRuns.values()];
  }

  listSourceSetsSnapshot(): SourceSet[] {
    return [...this.sourceSets.values()];
  }

  hydrate(snapshot: {
    projects?: Project[];
    sources?: Source[];
    crawlRuns?: CrawlRun[];
    sourceSets?: SourceSet[];
  }) {
    for (const project of snapshot.projects ?? []) {
      this.projects.set(project.id, {
        ...project,
        ownerUserId: project.ownerUserId ?? null,
      });
    }
    for (const source of snapshot.sources ?? []) {
      this.sources.set(source.id, {
        ...source,
        scope: source.scope ?? "personal",
        slug:
          source.slug ??
          slugifySourceName(source.name),
      });
    }
    for (const run of snapshot.crawlRuns ?? []) {
      this.crawlRuns.set(run.id, run);
    }
    for (const sourceSet of snapshot.sourceSets ?? []) {
      this.sourceSets.set(sourceSet.id, sourceSet);
    }
  }
}
