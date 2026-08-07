import { readFileSync, writeFileSync } from "node:fs";
import type { Pool } from "pg";
import pg from "pg";
import { createPgPool } from "../db/pg-store.js";
import { dataPath } from "../lib/data-dir.js";
import {
  getCloudPostgresConnectionString,
  getWritablePostgresConnectionString,
} from "../vector/config.js";
import type { MetadataCatalog } from "./metadata-catalog.js";

const { Pool: PgPool } = pg;

const CATALOG_FILE = dataPath("metadata-catalogs.json");

type CatalogSnapshot = Record<string, MetadataCatalog>;

let writablePool: Pool | null | undefined;
let cloudReadPool: Pool | null | undefined;

/** Owned DB — local docker / Cloud Run. Writes allowed. */
function getWritablePool(): Pool | null {
  if (writablePool === undefined) {
    writablePool = createPgPool();
  }
  return writablePool;
}

/** Remote cloud DB for local→cloud reads only. Never write through this pool. */
function getCloudReadPool(): Pool | null {
  if (cloudReadPool === undefined) {
    const connectionString = getCloudPostgresConnectionString();
    cloudReadPool = connectionString
      ? new PgPool({ connectionString })
      : null;
  }
  return cloudReadPool;
}

function loadCatalogSnapshot(): CatalogSnapshot {
  try {
    return JSON.parse(readFileSync(CATALOG_FILE, "utf8")) as CatalogSnapshot;
  } catch {
    return {};
  }
}

function persistCatalogSnapshot(snapshot: CatalogSnapshot) {
  writeFileSync(CATALOG_FILE, JSON.stringify(snapshot, null, 2), "utf8");
}

function getMetadataCatalogFromFile(sourceId: string): MetadataCatalog | null {
  const snapshot = loadCatalogSnapshot();
  return snapshot[sourceId] ?? null;
}

function saveMetadataCatalogToFile(
  sourceId: string,
  catalog: MetadataCatalog,
): MetadataCatalog {
  const snapshot = loadCatalogSnapshot();
  snapshot[sourceId] = catalog;
  persistCatalogSnapshot(snapshot);
  return catalog;
}

function deleteMetadataCatalogFromFile(sourceId: string): void {
  const snapshot = loadCatalogSnapshot();
  if (!(sourceId in snapshot)) return;
  delete snapshot[sourceId];
  persistCatalogSnapshot(snapshot);
}

function parseCatalog(value: unknown): MetadataCatalog | null {
  if (!value || typeof value !== "object") return null;
  const catalog = value as MetadataCatalog;
  if (typeof catalog.sourceId !== "string") return null;
  if (!Array.isArray(catalog.categories)) return null;
  if (!Array.isArray(catalog.pages)) return null;
  if (typeof catalog.updatedAt !== "string") return null;
  return catalog;
}

async function getMetadataCatalogFromPool(
  db: Pool,
  sourceId: string,
): Promise<MetadataCatalog | null> {
  const { rows } = await db.query<{ catalog: unknown }>(
    `SELECT catalog FROM source_catalogs WHERE source_id = $1`,
    [sourceId],
  );

  return rows[0] ? parseCatalog(rows[0].catalog) : null;
}

async function saveMetadataCatalogToPostgres(
  sourceId: string,
  catalog: MetadataCatalog,
): Promise<MetadataCatalog> {
  const db = getWritablePool();
  if (!db) return catalog;

  await db.query(
    `INSERT INTO source_catalogs (source_id, catalog, updated_at)
     VALUES ($1, $2::jsonb, $3::timestamptz)
     ON CONFLICT (source_id) DO UPDATE
     SET catalog = EXCLUDED.catalog,
         updated_at = EXCLUDED.updated_at`,
    [sourceId, JSON.stringify(catalog), catalog.updatedAt],
  );

  return catalog;
}

async function deleteMetadataCatalogFromPostgres(sourceId: string): Promise<void> {
  const db = getWritablePool();
  if (!db) return;

  await db.query(`DELETE FROM source_catalogs WHERE source_id = $1`, [sourceId]);
}

export async function getMetadataCatalog(
  sourceId: string,
): Promise<MetadataCatalog | null> {
  const writable = getWritablePool();
  if (writable) {
    const fromWritable = await getMetadataCatalogFromPool(writable, sourceId);
    if (fromWritable) return fromWritable;

    const fromFile = getMetadataCatalogFromFile(sourceId);
    // Only migrate file → owned Postgres (never into LEDGEINDEX_CLOUD_POSTGRES_URI).
    if (fromFile && getWritablePostgresConnectionString()) {
      await saveMetadataCatalogToPostgres(sourceId, fromFile);
      return fromFile;
    }
    if (fromFile) return fromFile;
  }

  const cloud = getCloudReadPool();
  if (cloud) {
    try {
      const fromCloud = await getMetadataCatalogFromPool(cloud, sourceId);
      if (fromCloud) return fromCloud;
    } catch {
      // Local without proxy / unreachable cloud — fall back to file catalog.
    }
  }

  return getMetadataCatalogFromFile(sourceId);
}

export async function saveMetadataCatalog(
  sourceId: string,
  catalog: MetadataCatalog,
): Promise<MetadataCatalog> {
  if (getWritablePool()) {
    return saveMetadataCatalogToPostgres(sourceId, catalog);
  }

  return saveMetadataCatalogToFile(sourceId, catalog);
}

export async function deleteMetadataCatalog(sourceId: string): Promise<void> {
  if (getWritablePool()) {
    await deleteMetadataCatalogFromPostgres(sourceId);
  }
  deleteMetadataCatalogFromFile(sourceId);
}
