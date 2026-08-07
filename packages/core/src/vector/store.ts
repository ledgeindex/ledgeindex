import type { MastraVector } from "@mastra/core/vector";
import { LibSQLVector } from "@mastra/libsql";
import { PgVector } from "@mastra/pg";
import { LEDGEINDEX_CHUNKS_INDEX } from "./constants.js";
import {
  getEmbeddingDimension,
  getLibSqlUrl,
  getVectorPostgresConnectionString,
  getVectorBackend,
  isCloudPostgresReadOnly,
  type VectorBackend,
} from "./config.js";
import { logInfo, logVerbose } from "../lib/logger.js";

const stores = new Map<VectorBackend, MastraVector>();
const indexReady = new Set<VectorBackend>();

/**
 * Local APIs with LEDGEINDEX_CLOUD_POSTGRES_URI may query cloud vectors but
 * must never create/index/delete against that remote DB.
 */
export function assertVectorStoreWritable(): void {
  if (isCloudPostgresReadOnly() && getVectorBackend() === "pgvector") {
    throw new Error(
      "Cloud Postgres is read-only on this API (LEDGEINDEX_CLOUD_POSTGRES_URI). " +
        "Query cloud sources here; index/delete only on the cloud API (or local LibSQL for personal sources).",
    );
  }
}

function createVectorStore(backend: VectorBackend): MastraVector {
  if (backend === "pgvector") {
    const connectionString = getVectorPostgresConnectionString();
    if (!connectionString) {
      throw new Error(
        "PgVector backend requires LEDGEINDEX_CLOUD_POSTGRES_URI (read-only local→cloud) " +
          "or POSTGRES_CONNECTION_STRING (writable owner API).",
      );
    }

    const mode = isCloudPostgresReadOnly() ? "cloud read-only" : "writable";
    logInfo(`Using PgVector store (${mode})`, "VectorStore");
    return new PgVector({
      id: "ledgeindex-pg",
      connectionString,
    });
  }

  logInfo("Using LibSQL vector store (local)", "VectorStore", {
    url: getLibSqlUrl(),
  });

  return new LibSQLVector({
    id: "ledgeindex-vector",
    url: getLibSqlUrl(),
  });
}

export function getVectorStore(): MastraVector {
  const backend = getVectorBackend();
  let store = stores.get(backend);
  if (!store) {
    store = createVectorStore(backend);
    stores.set(backend, store);
  }
  return store;
}

/** Ensure the chunks index exists with the correct embedding dimension. */
export async function ensureChunksIndex(): Promise<void> {
  const backend = getVectorBackend();
  if (indexReady.has(backend)) return;

  // Read-only cloud: index already exists remotely — do not createIndex (write).
  if (backend === "pgvector" && isCloudPostgresReadOnly()) {
    logVerbose("Skipping createIndex (cloud Postgres read-only)", "VectorStore", {
      indexName: LEDGEINDEX_CHUNKS_INDEX,
      backend,
    });
    indexReady.add(backend);
    return;
  }

  const store = getVectorStore();
  const dimension = getEmbeddingDimension();

  try {
    await store.createIndex({
      indexName: LEDGEINDEX_CHUNKS_INDEX,
      dimension,
    });
    logVerbose("Vector index ready", "VectorStore", {
      indexName: LEDGEINDEX_CHUNKS_INDEX,
      dimension,
      backend,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/already exists|duplicate/i.test(message)) {
      throw error;
    }
    logVerbose("Vector index already exists", "VectorStore", {
      indexName: LEDGEINDEX_CHUNKS_INDEX,
      backend,
    });
  }

  indexReady.add(backend);
}
