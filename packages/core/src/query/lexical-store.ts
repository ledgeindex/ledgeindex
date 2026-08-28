import { createClient, type Client } from "@libsql/client";
import { Pool } from "pg";
import { logInfo, logVerbose, logWarn } from "../lib/logger.js";
import {
  getLibSqlUrl,
  getVectorBackend,
  getVectorPostgresConnectionString,
  isCloudPostgresReadOnly,
} from "../vector/config.js";
import {
  LEXICAL_HEADING_WEIGHT,
  LEXICAL_TABLE,
  LEXICAL_TOP_K,
} from "../vector/constants.js";
import {
  expandIdentifiersForIndex,
  lexicalHeadingFor,
  lexicalQueryTerms,
  toFts5MatchQuery,
  toPostgresTsQuery,
} from "./code-tokens.js";

/**
 * Keyword retrieval alongside the dense vector index.
 *
 * A companion table mirrors each chunk's text and metadata so a lexical hit can
 * be handed back in the same shape as a vector hit. Mastra owns the vector
 * table, so this never touches it.
 *
 * Every write is best-effort: a lexical failure degrades retrieval to
 * dense-only and must never fail an ingest.
 */

export type LexicalChunkRow = {
  id: string;
  sourceId: string;
  url: string;
  text: string;
  metadata: Record<string, unknown>;
};

export type LexicalHit = {
  id: string;
  /** Backend-native relevance, higher is better. Only the order is meaningful. */
  score: number;
  metadata: Record<string, unknown>;
};

function parseLexicalMetadata(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      return parsed && typeof parsed === "object"
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function lexicalEnabled(): boolean {
  const raw = process.env.LEDGEINDEX_LEXICAL_SEARCH?.trim().toLowerCase();
  if (!raw) return true;
  return raw !== "0" && raw !== "false" && raw !== "off";
}

/** Rows per write statement. A large source would otherwise build one huge batch. */
const LEXICAL_WRITE_BATCH = 200;

/** Backends that reported missing capability — skipped for the process lifetime. */
const unavailable = new Set<string>();
const ready = new Set<string>();

function backendKey(): string {
  return getVectorBackend() === "pgvector"
    ? `pg:${getVectorPostgresConnectionString() ?? ""}`
    : `libsql:${getLibSqlUrl()}`;
}

function disable(reason: unknown, context: string): void {
  const message = reason instanceof Error ? reason.message : String(reason);
  const key = backendKey();
  if (!unavailable.has(key)) {
    unavailable.add(key);
    logWarn(`Lexical search disabled: ${message}`, "LexicalStore", { context });
  }
}

let pgPool: Pool | null = null;
let libsqlClient: Client | null = null;

function getPgPool(): Pool | null {
  const connectionString = getVectorPostgresConnectionString();
  if (!connectionString) return null;
  pgPool ??= new Pool({ connectionString });
  return pgPool;
}

function getLibsqlClient(): Client {
  libsqlClient ??= createClient({ url: getLibSqlUrl() });
  return libsqlClient;
}

/**
 * Drop a table left over from an older column layout. The lexical index is
 * derived data — the next ingest rebuilds it — so recreating is cheaper than
 * carrying migrations for it, and retrieval falls back to dense-only until
 * then.
 */
async function dropIfSchemaDrifted(): Promise<void> {
  const probe = `SELECT heading FROM ${LEXICAL_TABLE} LIMIT 1`;

  try {
    if (getVectorBackend() === "pgvector") {
      const pool = getPgPool();
      if (!pool) return;
      const exists = await pool.query(
        "SELECT 1 FROM information_schema.tables WHERE table_name = $1",
        [LEXICAL_TABLE],
      );
      if (exists.rowCount === 0) return;
      await pool.query(probe);
    } else {
      const client = getLibsqlClient();
      const exists = await client.execute({
        sql: "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
        args: [LEXICAL_TABLE],
      });
      if (exists.rows.length === 0) return;
      await client.execute(probe);
    }
    return;
  } catch {
    // Missing column — fall through and recreate.
  }

  logWarn("Lexical index schema changed, rebuilding on next ingest", "LexicalStore", {
    table: LEXICAL_TABLE,
  });
  try {
    if (getVectorBackend() === "pgvector") {
      await getPgPool()?.query(`DROP TABLE IF EXISTS ${LEXICAL_TABLE}`);
    } else {
      await getLibsqlClient().execute(`DROP TABLE IF EXISTS ${LEXICAL_TABLE}`);
    }
  } catch (error) {
    disable(error, "schema-drift");
  }
}

/**
 * Create the lexical table on first use. On Postgres this is DDL against the
 * vector database; on a read-only cloud connection it is skipped, matching how
 * the vector index is handled.
 */
export async function ensureLexicalIndex(): Promise<boolean> {
  if (!lexicalEnabled()) return false;
  const key = backendKey();
  if (unavailable.has(key)) return false;
  if (ready.has(key)) return true;

  try {
    if (getVectorBackend() === "pgvector") {
      const pool = getPgPool();
      if (!pool) {
        disable("no vector Postgres connection string", "ensure");
        return false;
      }
      if (isCloudPostgresReadOnly()) {
        // Cannot create it here; assume the owner API did and try to read.
        ready.add(key);
        return true;
      }
      await dropIfSchemaDrifted();
      await pool.query(
        `CREATE TABLE IF NOT EXISTS ${LEXICAL_TABLE} (
           vector_id TEXT PRIMARY KEY,
           source_id TEXT NOT NULL,
           url TEXT NOT NULL,
           metadata JSONB NOT NULL,
           heading TEXT NOT NULL,
           body TEXT NOT NULL,
           tsv tsvector NOT NULL
         )`,
      );
      await pool.query(
        `CREATE INDEX IF NOT EXISTS ${LEXICAL_TABLE}_tsv_idx
           ON ${LEXICAL_TABLE} USING GIN (tsv)`,
      );
      await pool.query(
        `CREATE INDEX IF NOT EXISTS ${LEXICAL_TABLE}_source_url_idx
           ON ${LEXICAL_TABLE} (source_id, url)`,
      );
    } else {
      await dropIfSchemaDrifted();
      const client = getLibsqlClient();
      await client.execute(
        `CREATE VIRTUAL TABLE IF NOT EXISTS ${LEXICAL_TABLE} USING fts5(
           vector_id UNINDEXED,
           source_id UNINDEXED,
           url UNINDEXED,
           metadata UNINDEXED,
           heading,
           body,
           tokenize = 'unicode61 remove_diacritics 0'
         )`,
      );
    }

    ready.add(key);
    logInfo("Lexical index ready", "LexicalStore", {
      backend: getVectorBackend(),
      table: LEXICAL_TABLE,
    });
    return true;
  } catch (error) {
    disable(error, "ensure");
    return false;
  }
}

export async function upsertLexicalChunks(
  rows: LexicalChunkRow[],
): Promise<number> {
  if (rows.length === 0) return 0;
  if (!(await ensureLexicalIndex())) return 0;
  if (getVectorBackend() === "pgvector" && isCloudPostgresReadOnly()) return 0;

  try {
    if (getVectorBackend() === "pgvector") {
      const pool = getPgPool();
      if (!pool) return 0;
      let written = 0;
      for (let offset = 0; offset < rows.length; offset += LEXICAL_WRITE_BATCH) {
        const batch = rows.slice(offset, offset + LEXICAL_WRITE_BATCH);
        const values: unknown[] = [];
        const tuples = batch.map((row, index) => {
          const base = index * 6;
          values.push(
            row.id,
            row.sourceId,
            row.url,
            JSON.stringify(row.metadata),
            lexicalHeadingFor(row.metadata),
            expandIdentifiersForIndex(row.text),
          );
          const heading = `$${base + 5}`;
          const body = `$${base + 6}`;
          // Weight A on the heading, B on the body — ts_rank_cd then favours a
          // path or symbol match over the same word buried in a function.
          return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}::jsonb, ${heading}, ${body},
             setweight(to_tsvector('simple', ${heading}), 'A') ||
             setweight(to_tsvector('simple', ${body}), 'B'))`;
        });
        await pool.query(
          `INSERT INTO ${LEXICAL_TABLE} (vector_id, source_id, url, metadata, heading, body, tsv)
           VALUES ${tuples.join(", ")}
           ON CONFLICT (vector_id) DO UPDATE SET
             source_id = EXCLUDED.source_id,
             url = EXCLUDED.url,
             metadata = EXCLUDED.metadata,
             heading = EXCLUDED.heading,
             body = EXCLUDED.body,
             tsv = EXCLUDED.tsv`,
          values,
        );
        written += batch.length;
      }
      return written;
    }

    const client = getLibsqlClient();
    // fts5 has no upsert; delete the ids first so a re-index cannot duplicate.
    for (let offset = 0; offset < rows.length; offset += LEXICAL_WRITE_BATCH) {
      const batch = rows.slice(offset, offset + LEXICAL_WRITE_BATCH);
      await client.batch(
        [
          ...batch.map((row) => ({
            sql: `DELETE FROM ${LEXICAL_TABLE} WHERE vector_id = ?`,
            args: [row.id],
          })),
          ...batch.map((row) => ({
            sql: `INSERT INTO ${LEXICAL_TABLE} (vector_id, source_id, url, metadata, heading, body)
                  VALUES (?, ?, ?, ?, ?, ?)`,
            args: [
              row.id,
              row.sourceId,
              row.url,
              JSON.stringify(row.metadata),
              lexicalHeadingFor(row.metadata),
              expandIdentifiersForIndex(row.text),
            ],
          })),
        ],
        "write",
      );
    }
    return rows.length;
  } catch (error) {
    disable(error, "upsert");
    return 0;
  }
}

/**
 * Deterministically enumerate the indexed chunk mirror for a source.
 * Returns an empty array when the lexical mirror is unavailable.
 */
export async function listLexicalChunksForSource(
  sourceId: string,
): Promise<LexicalChunkRow[]> {
  const normalizedSourceId = sourceId.trim();
  if (!normalizedSourceId || !(await ensureLexicalIndex())) return [];

  try {
    if (getVectorBackend() === "pgvector") {
      const pool = getPgPool();
      if (!pool) return [];
      const { rows } = await pool.query<{
        vector_id: string;
        source_id: string;
        url: string;
        metadata: unknown;
      }>(
        `SELECT vector_id, source_id, url, metadata
           FROM ${LEXICAL_TABLE}
          WHERE source_id = $1
          ORDER BY url, vector_id`,
        [normalizedSourceId],
      );
      return rows.map((row) => {
        const metadata = parseLexicalMetadata(row.metadata);
        return {
          id: row.vector_id,
          sourceId: row.source_id,
          url: row.url,
          text: String(metadata.text ?? ""),
          metadata,
        };
      });
    }

    const result = await getLibsqlClient().execute({
      sql: `SELECT vector_id, source_id, url, metadata
              FROM ${LEXICAL_TABLE}
             WHERE source_id = ?
             ORDER BY url, vector_id`,
      args: [normalizedSourceId],
    });
    return result.rows.map((row) => {
      const metadata = parseLexicalMetadata(row.metadata);
      return {
        id: String(row.vector_id ?? ""),
        sourceId: String(row.source_id ?? normalizedSourceId),
        url: String(row.url ?? ""),
        text: String(metadata.text ?? ""),
        metadata,
      };
    });
  } catch (error) {
    disable(error, "list-source");
    return [];
  }
}

export async function deleteLexicalChunks(input: {
  sourceId: string;
  /** Limit the delete to one page; omit to drop the whole source. */
  url?: string;
  /** Limit the delete to many pages (batched). */
  urls?: string[];
}): Promise<void> {
  if (!(await ensureLexicalIndex())) return;
  if (getVectorBackend() === "pgvector" && isCloudPostgresReadOnly()) return;

  const urls = [
    ...new Set(
      [...(input.urls ?? []), ...(input.url ? [input.url] : [])].filter(Boolean),
    ),
  ];

  try {
    if (getVectorBackend() === "pgvector") {
      const pool = getPgPool();
      if (!pool) return;
      if (urls.length === 1) {
        await pool.query(
          `DELETE FROM ${LEXICAL_TABLE} WHERE source_id = $1 AND url = $2`,
          [input.sourceId, urls[0]],
        );
      } else if (urls.length > 1) {
        await pool.query(
          `DELETE FROM ${LEXICAL_TABLE} WHERE source_id = $1 AND url = ANY($2::text[])`,
          [input.sourceId, urls],
        );
      } else {
        await pool.query(`DELETE FROM ${LEXICAL_TABLE} WHERE source_id = $1`, [
          input.sourceId,
        ]);
      }
      return;
    }

    const client = getLibsqlClient();
    if (urls.length > 0) {
      const batchSize = 80;
      for (let offset = 0; offset < urls.length; offset += batchSize) {
        const batch = urls.slice(offset, offset + batchSize);
        const placeholders = batch.map(() => "?").join(", ");
        await client.execute({
          sql: `DELETE FROM ${LEXICAL_TABLE} WHERE source_id = ? AND url IN (${placeholders})`,
          args: [input.sourceId, ...batch],
        });
      }
    } else {
      await client.execute({
        sql: `DELETE FROM ${LEXICAL_TABLE} WHERE source_id = ?`,
        args: [input.sourceId],
      });
    }
  } catch (error) {
    disable(error, "delete");
  }
}

function parseMetadata(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object") return raw as Record<string, unknown>;
  if (typeof raw !== "string") return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export async function searchLexical(input: {
  sourceId: string;
  query: string;
  topK?: number;
  /** Restrict to one page, mirroring the vector filter. */
  url?: string;
}): Promise<LexicalHit[]> {
  if (!(await ensureLexicalIndex())) return [];

  const terms = lexicalQueryTerms(input.query);
  if (terms.length === 0) return [];
  const topK = input.topK ?? LEXICAL_TOP_K;

  try {
    if (getVectorBackend() === "pgvector") {
      const pool = getPgPool();
      if (!pool) return [];
      const tsquery = toPostgresTsQuery(terms);
      if (!tsquery) return [];
      const params: unknown[] = [input.sourceId, tsquery, topK];
      const urlClause = input.url ? "AND url = $4" : "";
      if (input.url) params.push(input.url);

      const { rows } = await pool.query<{
        vector_id: string;
        metadata: unknown;
        rank: number;
      }>(
        `SELECT vector_id, metadata, ts_rank_cd(tsv, query) AS rank
           FROM ${LEXICAL_TABLE}, to_tsquery('simple', $2) AS query
          WHERE source_id = $1 AND tsv @@ query ${urlClause}
          ORDER BY rank DESC
          LIMIT $3`,
        params,
      );
      return rows.map((row) => ({
        id: row.vector_id,
        score: Number(row.rank) || 0,
        metadata: parseMetadata(row.metadata),
      }));
    }

    const client = getLibsqlClient();
    const match = toFts5MatchQuery(terms);
    if (!match) return [];
    const args: unknown[] = [match, input.sourceId];
    const urlClause = input.url ? "AND url = ?" : "";
    if (input.url) args.push(input.url);
    args.push(topK);

    const result = await client.execute({
      // bm25() is negative with better matches more negative, so negate it. The
      // weights are positional over every declared column; only heading and
      // body are indexed, and heading counts for more.
      sql: `SELECT vector_id, metadata,
                   -bm25(${LEXICAL_TABLE}, 0.0, 0.0, 0.0, 0.0, ${LEXICAL_HEADING_WEIGHT}, 1.0) AS rank
              FROM ${LEXICAL_TABLE}
             WHERE ${LEXICAL_TABLE} MATCH ? AND source_id = ? ${urlClause}
             ORDER BY rank DESC
             LIMIT ?`,
      args: args as never,
    });

    return result.rows.map((row) => ({
      id: String(row.vector_id ?? ""),
      score: Number(row.rank) || 0,
      metadata: parseMetadata(row.metadata),
    }));
  } catch (error) {
    disable(error, "search");
    return [];
  }
}

export function describeLexicalSetup(): {
  enabled: boolean;
  backend: string;
  table: string;
  available: boolean;
} {
  const key = backendKey();
  return {
    enabled: lexicalEnabled(),
    backend: getVectorBackend(),
    table: LEXICAL_TABLE,
    available: lexicalEnabled() && !unavailable.has(key),
  };
}

/** Test hook — forget capability probing between runs. */
export function resetLexicalStoreState(): void {
  unavailable.clear();
  ready.clear();
  logVerbose("Lexical store state reset", "LexicalStore");
}
