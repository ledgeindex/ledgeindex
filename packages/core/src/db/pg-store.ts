import pg from "pg";
import { randomUUID } from "node:crypto";
import type { WebCrawlSourceConfig } from "../schemas/source-config.js";
import type { SourceMetadata } from "../schemas/source-metadata.js";
import type {
  CrawlRun,
  CrawlRunKind,
  Project,
  Source,
  SourceIndexStats,
  SourceHosting,
  SourceScope,
  SourceSet,
  Store,
} from "./types.js";
import { PLATFORM_PROJECT_NAME } from "./types.js";
import { resolveSourceHosting } from "./source-hosting.js";
import {
  ensureUniqueSourceSlug,
  globalSlugOwnerKey,
  slugifySourceName,
} from "../lib/source-slug.js";
import { getCloudPostgresConnectionString } from "../vector/config.js";

const { Pool } = pg;

function mapProject(row: pg.QueryResultRow): Project {
  return {
    id: row.id,
    name: row.name,
    ownerUserId: row.owner_user_id ?? null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function mapSource(row: pg.QueryResultRow): Source {
  const scope = (row.scope as SourceScope | undefined) ?? "personal";
  const indexStats = (row.index_stats as SourceIndexStats | null) ?? null;
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    slug: row.slug ?? slugifySourceName(row.name),
    type: "web_crawl",
    scope,
    hosting: resolveSourceHosting({
      hosting: row.hosting as SourceHosting | undefined,
      scope,
      vectorBackend: indexStats?.vectorBackend,
    }),
    config: row.config as WebCrawlSourceConfig,
    ogImageUrl: row.og_image_url ?? null,
    faviconUrl: row.favicon_url ?? null,
    sourceMetadata: (row.source_metadata as SourceMetadata | null) ?? null,
    indexedAt: row.indexed_at?.toISOString?.() ?? row.indexed_at ?? null,
    indexStats,
    canonicalUrl: row.canonical_url ?? null,
    sourceFamilyId: row.source_family_id ?? null,
    versionNumber: row.version_number ?? 1,
    versionLabel: row.version_label ?? null,
    categories: Array.isArray(row.categories) ? row.categories : [],
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function mapCrawlRun(row: pg.QueryResultRow): CrawlRun {
  return {
    id: row.id,
    sourceId: row.source_id,
    kind: row.kind,
    status: row.status,
    pagesDiscovered: row.pages_discovered,
    pagesProcessed: row.pages_processed,
    error: row.error,
    result: (row.result ?? {}) as CrawlRun["result"],
    startedAt: row.started_at?.toISOString() ?? null,
    finishedAt: row.finished_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
  };
}

function mapSourceSet(row: pg.QueryResultRow): SourceSet {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    name: row.name,
    slug: row.slug,
    description: row.description ?? null,
    sourceIds: Array.isArray(row.source_ids) ? row.source_ids : [],
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export class PgStore implements Store {
  private sourceColumns: { categories: boolean; hosting: boolean } | null =
    null;

  constructor(private pool: pg.Pool) {}

  /** Cached schema probe — avoids hard-failing when a migration is not applied yet. */
  private async loadSourceColumns(): Promise<{
    categories: boolean;
    hosting: boolean;
  }> {
    if (this.sourceColumns) return this.sourceColumns;

    const { rows } = await this.pool.query<{ column_name: string }>(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'sources'
         AND column_name = ANY($1::text[])`,
      [["categories", "hosting"]],
    );

    const names = new Set(rows.map((row) => row.column_name));
    if (!names.has("hosting")) {
      await this.pool.query(
        `ALTER TABLE sources ADD COLUMN IF NOT EXISTS hosting text`,
      );
      names.add("hosting");
    }
    if (!names.has("categories")) {
      await this.pool.query(
        `ALTER TABLE sources ADD COLUMN IF NOT EXISTS categories text[] DEFAULT '{}'`,
      );
      names.add("categories");
    }

    this.sourceColumns = {
      categories: names.has("categories"),
      hosting: names.has("hosting"),
    };
    return this.sourceColumns;
  }

  async createProject(name: string, ownerUserId: string): Promise<Project> {
    const id = randomUUID();
    const { rows } = await this.pool.query(
      `INSERT INTO projects (id, name, owner_user_id) VALUES ($1, $2, $3) RETURNING *`,
      [id, name, ownerUserId],
    );
    return mapProject(rows[0]);
  }

  async getOrCreatePlatformProject(): Promise<Project> {
    const { rows: existing } = await this.pool.query(
      `SELECT * FROM projects WHERE owner_user_id IS NULL AND name = $1 LIMIT 1`,
      [PLATFORM_PROJECT_NAME],
    );
    if (existing[0]) return mapProject(existing[0]);

    const id = randomUUID();
    const { rows } = await this.pool.query(
      `INSERT INTO projects (id, name, owner_user_id) VALUES ($1, $2, NULL) RETURNING *`,
      [id, PLATFORM_PROJECT_NAME],
    );
    return mapProject(rows[0]);
  }

  async getProject(id: string): Promise<Project | null> {
    const { rows } = await this.pool.query(
      `SELECT * FROM projects WHERE id = $1`,
      [id],
    );
    return rows[0] ? mapProject(rows[0]) : null;
  }

  async listProjects(ownerUserId?: string): Promise<Project[]> {
    const { rows } = ownerUserId
      ? await this.pool.query(
          `SELECT * FROM projects WHERE owner_user_id = $1 ORDER BY updated_at DESC`,
          [ownerUserId],
        )
      : await this.pool.query(`SELECT * FROM projects ORDER BY updated_at DESC`);
    return rows.map(mapProject);
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
  }): Promise<Source> {
    await this.loadSourceColumns();
    const id = randomUUID();
    const slug = await ensureUniqueSourceSlug(
      input.slug ?? slugifySourceName(input.name),
      input.slugOwnerKey,
      async (candidate, ownerKey) => this.isSourceSlugTaken(candidate, ownerKey),
    );
    const sourceFamilyId = input.sourceFamilyId ?? id;
    const versionNumber = input.versionNumber ?? 1;
    const scope = input.scope ?? "personal";
    const hosting = input.hosting ?? "cloud";
    const { rows } = await this.pool.query(
      `INSERT INTO sources (
         id, project_id, name, slug, slug_owner_key, type, scope, hosting, config, source_metadata,
         canonical_url, source_family_id, version_number, version_label
       )
       VALUES ($1, $2, $3, $4, $5, 'web_crawl', $6, $7, $8::jsonb, $9::jsonb, $10, $11, $12, $13)
       RETURNING *`,
      [
        id,
        input.projectId,
        input.name,
        slug,
        input.slugOwnerKey,
        scope,
        hosting,
        JSON.stringify(input.config),
        input.sourceMetadata ? JSON.stringify(input.sourceMetadata) : null,
        input.canonicalUrl ?? null,
        sourceFamilyId,
        versionNumber,
        input.versionLabel ?? null,
      ],
    );
    return mapSource(rows[0]);
  }

  async getSourceBySlug(slug: string, slugOwnerKey: string): Promise<Source | null> {
    const { rows } = await this.pool.query(
      `SELECT * FROM sources WHERE slug = $1 AND slug_owner_key = $2 LIMIT 1`,
      [slug.trim().toLowerCase(), slugOwnerKey],
    );
    return rows[0] ? mapSource(rows[0]) : null;
  }

  async isSourceSlugTaken(
    slug: string,
    slugOwnerKey: string,
    excludeSourceId?: string,
  ): Promise<boolean> {
    const { rows } = await this.pool.query(
      `SELECT id FROM sources
       WHERE slug = $1 AND slug_owner_key = $2
       ${excludeSourceId ? "AND id <> $3" : ""}
       LIMIT 1`,
      excludeSourceId
        ? [slug.trim().toLowerCase(), slugOwnerKey, excludeSourceId]
        : [slug.trim().toLowerCase(), slugOwnerKey],
    );
    return Boolean(rows[0]);
  }

  async getSource(id: string): Promise<Source | null> {
    const { rows } = await this.pool.query(`SELECT * FROM sources WHERE id = $1`, [
      id,
    ]);
    return rows[0] ? mapSource(rows[0]) : null;
  }

  async listSources(projectId?: string): Promise<Source[]> {
    const { rows } = projectId
      ? await this.pool.query(
          `SELECT * FROM sources WHERE project_id = $1 ORDER BY updated_at DESC`,
          [projectId],
        )
      : await this.pool.query(`SELECT * FROM sources ORDER BY updated_at DESC`);
    return rows.map(mapSource);
  }

  async listPersonalSourcesForOwner(ownerUserId: string): Promise<Source[]> {
    const { rows } = await this.pool.query(
      `SELECT s.*
       FROM sources s
       INNER JOIN projects p ON p.id = s.project_id
       WHERE p.owner_user_id = $1
         AND COALESCE(s.scope, 'personal') <> 'global'
       ORDER BY s.updated_at DESC`,
      [ownerUserId],
    );
    return rows.map(mapSource);
  }

  async listGlobalSources(): Promise<Source[]> {
    const { rows } = await this.pool.query(
      `SELECT * FROM sources WHERE scope = 'global' ORDER BY updated_at DESC`,
    );
    return rows.map(mapSource);
  }

  async listSourcesByCanonicalUrl(
    canonicalUrl: string,
    scope: SourceScope,
    slugOwnerKey: string,
  ): Promise<Source[]> {
    const { rows } = await this.pool.query(
      `SELECT * FROM sources
       WHERE canonical_url = $1
         AND scope = $2
         AND slug_owner_key = $3
       ORDER BY version_number DESC, updated_at DESC`,
      [canonicalUrl, scope, slugOwnerKey],
    );
    return rows.map(mapSource);
  }

  async listSourcesByFamilyId(sourceFamilyId: string): Promise<Source[]> {
    const { rows } = await this.pool.query(
      `SELECT * FROM sources
       WHERE source_family_id = $1
       ORDER BY version_number DESC, updated_at DESC`,
      [sourceFamilyId],
    );
    return rows.map(mapSource);
  }

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
      indexStats?: SourceIndexStats | null;
      canonicalUrl?: string | null;
      sourceFamilyId?: string | null;
      versionNumber?: number;
      versionLabel?: string | null;
      categories?: string[];
    },
  ): Promise<Source | null> {
    const existing = await this.getSource(id);
    if (!existing) return null;

    const ownerKey =
      input.slugOwnerKey ??
      (existing.scope === "global"
        ? globalSlugOwnerKey()
        : ((await this.getProject(existing.projectId))?.ownerUserId ?? ""));

    let slug = existing.slug;
    if (input.slug !== undefined) {
      slug = await ensureUniqueSourceSlug(input.slug, ownerKey, async (candidate, key) =>
        this.isSourceSlugTaken(candidate, key, id),
      );
    }

    const columns = await this.loadSourceColumns();
    const values = [
      id,
      input.name ?? existing.name,
      slug,
      ownerKey,
      JSON.stringify(input.config ?? existing.config),
      input.ogImageUrl !== undefined ? input.ogImageUrl : existing.ogImageUrl,
      input.faviconUrl !== undefined ? input.faviconUrl : existing.faviconUrl,
      JSON.stringify(
        input.sourceMetadata !== undefined
          ? input.sourceMetadata
          : existing.sourceMetadata,
      ),
      input.indexedAt !== undefined ? input.indexedAt : existing.indexedAt,
      JSON.stringify(
        input.indexStats !== undefined ? input.indexStats : existing.indexStats,
      ),
      input.canonicalUrl !== undefined ? input.canonicalUrl : existing.canonicalUrl,
      input.sourceFamilyId !== undefined ? input.sourceFamilyId : existing.sourceFamilyId,
      input.versionNumber !== undefined ? input.versionNumber : existing.versionNumber,
      input.versionLabel !== undefined ? input.versionLabel : existing.versionLabel,
    ] as const;

    const categoriesClause = columns.categories
      ? `, categories = $15::text[]`
      : "";
    const categoriesValue = columns.categories
      ? [
          input.categories !== undefined
            ? input.categories
            : (existing.categories ?? []),
        ]
      : [];

    const { rows } = await this.pool.query(
      `UPDATE sources
       SET name = $2,
           slug = $3,
           slug_owner_key = $4,
           config = $5::jsonb,
           og_image_url = $6,
           favicon_url = $7,
           source_metadata = $8::jsonb,
           indexed_at = $9,
           index_stats = $10::jsonb,
           canonical_url = $11,
           source_family_id = $12,
           version_number = $13,
           version_label = $14${categoriesClause},
           updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [...values, ...categoriesValue],
    );
    return rows[0] ? mapSource(rows[0]) : null;
  }

  async deleteSource(id: string): Promise<boolean> {
    const existing = await this.getSource(id);
    if (!existing) return false;

    await this.pool.query(`DELETE FROM crawl_runs WHERE source_id = $1`, [id]);
    const { rowCount } = await this.pool.query(`DELETE FROM sources WHERE id = $1`, [
      id,
    ]);
    return (rowCount ?? 0) > 0;
  }

  async createCrawlRun(input: {
    sourceId: string;
    kind: CrawlRunKind;
  }): Promise<CrawlRun> {
    const id = randomUUID();
    const { rows } = await this.pool.query(
      `INSERT INTO crawl_runs (id, source_id, kind, status)
       VALUES ($1, $2, $3, 'pending')
       RETURNING *`,
      [id, input.sourceId, input.kind],
    );
    return mapCrawlRun(rows[0]);
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
    const existing = await this.getCrawlRun(id);
    if (!existing) return null;

    const { rows } = await this.pool.query(
      `UPDATE crawl_runs
       SET status = $2,
           pages_discovered = $3,
           pages_processed = $4,
           error = $5,
           result = $6::jsonb,
           started_at = $7,
           finished_at = $8
       WHERE id = $1
       RETURNING *`,
      [
        id,
        input.status ?? existing.status,
        input.pagesDiscovered ?? existing.pagesDiscovered,
        input.pagesProcessed ?? existing.pagesProcessed,
        input.error ?? existing.error,
        JSON.stringify(input.result ?? existing.result),
        input.startedAt ?? existing.startedAt,
        input.finishedAt ?? existing.finishedAt,
      ],
    );
    return rows[0] ? mapCrawlRun(rows[0]) : null;
  }

  async getCrawlRun(id: string): Promise<CrawlRun | null> {
    const { rows } = await this.pool.query(
      `SELECT * FROM crawl_runs WHERE id = $1`,
      [id],
    );
    return rows[0] ? mapCrawlRun(rows[0]) : null;
  }

  async createSourceSet(input: {
    ownerUserId: string;
    name: string;
    slug: string;
    description?: string | null;
    sourceIds: string[];
  }): Promise<SourceSet> {
    const id = randomUUID();
    const slug = await ensureUniqueSourceSlug(
      input.slug,
      input.ownerUserId,
      async (candidate, ownerKey) => this.isSourceSetSlugTaken(ownerKey, candidate),
    );
    const { rows } = await this.pool.query(
      `INSERT INTO source_sets (id, owner_user_id, name, slug, description, source_ids)
       VALUES ($1, $2, $3, $4, $5, $6::uuid[])
       RETURNING *`,
      [
        id,
        input.ownerUserId,
        input.name,
        slug,
        input.description ?? null,
        input.sourceIds,
      ],
    );
    return mapSourceSet(rows[0]);
  }

  async getSourceSet(id: string): Promise<SourceSet | null> {
    const { rows } = await this.pool.query(
      `SELECT * FROM source_sets WHERE id = $1`,
      [id],
    );
    return rows[0] ? mapSourceSet(rows[0]) : null;
  }

  async getSourceSetBySlug(
    ownerUserId: string,
    slug: string,
  ): Promise<SourceSet | null> {
    const { rows } = await this.pool.query(
      `SELECT * FROM source_sets WHERE owner_user_id = $1 AND slug = $2 LIMIT 1`,
      [ownerUserId, slug.trim().toLowerCase()],
    );
    return rows[0] ? mapSourceSet(rows[0]) : null;
  }

  async listSourceSets(ownerUserId: string): Promise<SourceSet[]> {
    const { rows } = await this.pool.query(
      `SELECT * FROM source_sets WHERE owner_user_id = $1 ORDER BY updated_at DESC`,
      [ownerUserId],
    );
    return rows.map(mapSourceSet);
  }

  async isSourceSetSlugTaken(
    ownerUserId: string,
    slug: string,
    excludeSourceSetId?: string,
  ): Promise<boolean> {
    const { rows } = await this.pool.query(
      `SELECT id FROM source_sets
       WHERE owner_user_id = $1 AND slug = $2
       ${excludeSourceSetId ? "AND id <> $3" : ""}
       LIMIT 1`,
      excludeSourceSetId
        ? [ownerUserId, slug.trim().toLowerCase(), excludeSourceSetId]
        : [ownerUserId, slug.trim().toLowerCase()],
    );
    return Boolean(rows[0]);
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
    const existing = await this.getSourceSet(id);
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

    const { rows } = await this.pool.query(
      `UPDATE source_sets
       SET name = $2,
           slug = $3,
           description = $4,
           source_ids = $5::uuid[],
           updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [
        id,
        input.name ?? existing.name,
        slug,
        input.description !== undefined ? input.description : existing.description,
        input.sourceIds ?? existing.sourceIds,
      ],
    );
    return rows[0] ? mapSourceSet(rows[0]) : null;
  }

  async deleteSourceSet(id: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(`DELETE FROM source_sets WHERE id = $1`, [
      id,
    ]);
    return (rowCount ?? 0) > 0;
  }
}

export function createPgPool() {
  const connectionString = process.env.POSTGRES_CONNECTION_STRING;
  if (!connectionString) return null;
  return new Pool({ connectionString });
}

/** Read-only pool for LEDGEINDEX_CLOUD_POSTGRES_URI (local → cloud query). */
export function createCloudReadPool() {
  const connectionString = getCloudPostgresConnectionString();
  if (!connectionString) return null;
  return new Pool({ connectionString });
}
