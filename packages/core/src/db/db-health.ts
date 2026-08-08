import { createPgPool } from "./pg-store.js";

export type MigrationCheck = {
  id: string;
  description: string;
  ready: boolean;
  missing: string[];
};

export type DbHealthReport = {
  store: "postgres" | "file" | "memory";
  postgresConfigured: boolean;
  postgresReachable: boolean;
  extensions: Record<string, boolean>;
  tables: Record<string, boolean>;
  migrations: MigrationCheck[];
  allMigrationsReady: boolean;
  sourcesWithMetadata: number | null;
  sourcesWithLlmsTxt: number | null;
  error?: string;
};

const MIGRATION_CHECKS: Array<{
  id: string;
  description: string;
  columns?: string[];
  tables?: string[];
}> = [
  {
    id: "001_initial",
    description: "Core schema (projects, sources, crawl_runs)",
    tables: ["projects", "sources", "crawl_runs"],
  },
  {
    id: "003_source_presentation",
    description: "OG image + index stats on sources",
    columns: ["og_image_url", "indexed_at", "index_stats"],
  },
  {
    id: "004_source_favicon",
    description: "Favicon URL on sources",
    columns: ["favicon_url"],
  },
  {
    id: "005_source_metadata",
    description: "Source metadata JSONB (signals, llmsTxt, etc.)",
    columns: ["source_metadata"],
  },
  {
    id: "007_source_scope",
    description: "Personal vs global scope",
    columns: ["scope"],
  },
  {
    id: "008_source_slug",
    description: "Source slugs",
    columns: ["slug", "slug_owner_key"],
  },
  {
    id: "009_source_sets",
    description: "Source sets table",
    tables: ["source_sets"],
  },
  {
    id: "010_source_versioning",
    description: "Documentation version families",
    columns: [
      "canonical_url",
      "source_family_id",
      "version_number",
      "version_label",
    ],
  },
  {
    id: "011_source_taxonomy",
    description: "Admin taxonomy categories on sources",
    columns: ["categories"],
  },
  {
    id: "012_source_catalogs",
    description: "Durable metadata catalog per source",
    tables: ["source_catalogs"],
  },
];

function resolveStoreKind(): DbHealthReport["store"] {
  if (process.env.POSTGRES_CONNECTION_STRING?.trim()) return "postgres";
  if (process.env.LEDGEINDEX_MEMORY_STORE === "1") return "memory";
  return "file";
}

export async function inspectDbHealth(): Promise<DbHealthReport> {
  const store = resolveStoreKind();
  const postgresConfigured = store === "postgres";

  if (!postgresConfigured) {
    return {
      store,
      postgresConfigured: false,
      postgresReachable: false,
      extensions: {},
      tables: {},
      migrations: [],
      allMigrationsReady: false,
      sourcesWithMetadata: null,
      sourcesWithLlmsTxt: null,
      error:
        store === "file"
          ? "Using local FileStore (.data/dev-store.json). Run migrations only matter after POSTGRES_CONNECTION_STRING is set."
          : "Using in-memory store. Data is not persisted.",
    };
  }

  const pool = createPgPool();
  if (!pool) {
    return {
      store,
      postgresConfigured: true,
      postgresReachable: false,
      extensions: {},
      tables: {},
      migrations: [],
      allMigrationsReady: false,
      sourcesWithMetadata: null,
      sourcesWithLlmsTxt: null,
      error: "POSTGRES_CONNECTION_STRING is set but pool could not be created.",
    };
  }

  try {
    const [columnRows, tableRows, extensionRows, statsRows] = await Promise.all([
      pool.query<{ column_name: string }>(
        `SELECT column_name
         FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'sources'`,
      ),
      pool.query<{ table_name: string }>(
        `SELECT table_name
         FROM information_schema.tables
         WHERE table_schema = 'public'`,
      ),
      pool.query<{ extname: string }>(
        `SELECT extname FROM pg_extension WHERE extname IN ('vector', 'pgcrypto')`,
      ),
      pool.query<{ with_metadata: string; with_llms_txt: string }>(
        `SELECT
           COUNT(*) FILTER (WHERE source_metadata IS NOT NULL)::text AS with_metadata,
           COUNT(*) FILTER (WHERE source_metadata->'llmsTxt' IS NOT NULL)::text AS with_llms_txt
         FROM sources`,
      ),
    ]);

    const sourceColumns = new Set(columnRows.rows.map((row) => row.column_name));
    const tables = new Set(tableRows.rows.map((row) => row.table_name));
    const extensions = Object.fromEntries(
      ["vector", "pgcrypto"].map((name) => [
        name,
        extensionRows.rows.some((row) => row.extname === name),
      ]),
    );

    const tableStatus = Object.fromEntries(
      [...tables].map((name) => [name, true]),
    );

    const migrations = MIGRATION_CHECKS.map((check) => {
      const missingColumns =
        check.columns?.filter((column) => !sourceColumns.has(column)) ?? [];
      const missingTables =
        check.tables?.filter((table) => !tables.has(table)) ?? [];
      const missing = [...missingColumns, ...missingTables];

      return {
        id: check.id,
        description: check.description,
        ready: missing.length === 0,
        missing,
      };
    });

    const stats = statsRows.rows[0];

    return {
      store: "postgres",
      postgresConfigured: true,
      postgresReachable: true,
      extensions,
      tables: tableStatus,
      migrations,
      allMigrationsReady: migrations.every((migration) => migration.ready),
      sourcesWithMetadata: Number(stats?.with_metadata ?? 0),
      sourcesWithLlmsTxt: Number(stats?.with_llms_txt ?? 0),
    };
  } catch (error) {
    return {
      store: "postgres",
      postgresConfigured: true,
      postgresReachable: false,
      extensions: {},
      tables: {},
      migrations: [],
      allMigrationsReady: false,
      sourcesWithMetadata: null,
      sourcesWithLlmsTxt: null,
      error: error instanceof Error ? error.message : "Database health check failed",
    };
  } finally {
    await pool.end();
  }
}
