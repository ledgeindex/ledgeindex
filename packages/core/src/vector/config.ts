import {
  LOCAL_EMBEDDING_DIMENSION,
  PROD_EMBEDDING_DIMENSION,
} from "./constants.js";
import { dataPath } from "../lib/data-dir.js";
import { preferCloudRetrieval } from "../query/rerank-request-context.js";

export type VectorBackend = "libsql" | "pgvector";

/**
 * Writable Postgres for this process (Cloud Run / local docker owning the DB).
 * Never point a local API at production with this var — use
 * {@link getCloudPostgresConnectionString} for read-only cloud queries instead.
 */
export function getWritablePostgresConnectionString(): string | undefined {
  const value =
    process.env.POSTGRES_CONNECTION_STRING?.trim() ||
    process.env.MASTRA_POSTGRES_URI?.trim() ||
    "";
  return value || undefined;
}

/**
 * Cloud Run stores `?host=/cloudsql/...` socket URIs. Locally we talk through
 * Cloud SQL Auth Proxy on 127.0.0.1 (see VS Code task "Start Cloud SQL Auth Proxy").
 * Node's URL parser rejects empty-host postgres socket URIs, so rewrite manually.
 */
function rewriteCloudSqlSocketUriForLocalProxy(uri: string): string {
  if (!uri.includes("/cloudsql/")) return uri;

  const proxyPort =
    process.env.LEDGEINDEX_CLOUD_SQL_PROXY_PORT?.trim() || "5432";

  // postgresql://user:pass@/dbname?host=/cloudsql/...
  const socketForm = uri.match(
    /^(postgresql|postgres):\/\/([^/@]+)@\/([^?]*)\?([^#]*)$/i,
  );
  if (socketForm) {
    const protocol = socketForm[1];
    const userinfo = socketForm[2];
    const database = socketForm[3] || "ledgeindex";
    const params = new URLSearchParams(socketForm[4]);
    params.delete("host");
    const qs = params.toString();
    return `${protocol}://${userinfo}@127.0.0.1:${proxyPort}/${database}${qs ? `?${qs}` : ""}`;
  }

  // postgresql://user:pass@host/db?host=/cloudsql/... (odd but handle)
  try {
    const asHttp = uri.replace(/^postgresql:/i, "http:").replace(/^postgres:/i, "http:");
    const parsed = new URL(asHttp);
    const database =
      parsed.pathname.replace(/^\//, "").trim() || "ledgeindex";
    parsed.hostname = "127.0.0.1";
    parsed.port = proxyPort;
    parsed.searchParams.delete("host");
    const qs = parsed.searchParams.toString();
    return `postgresql://${parsed.username}${parsed.password ? `:${parsed.password}` : ""}@127.0.0.1:${proxyPort}/${database}${qs ? `?${qs}` : ""}`;
  } catch {
    return uri;
  }
}

/**
 * Read-only remote Postgres for querying cloud vectors/catalogs from a local API.
 * Local must not write through this URI.
 * Socket URIs are rewritten to 127.0.0.1 when Cloud SQL Auth Proxy is used.
 */
export function getCloudPostgresConnectionString(): string | undefined {
  const value = process.env.LEDGEINDEX_CLOUD_POSTGRES_URI?.trim() || "";
  if (!value) return undefined;
  return rewriteCloudSqlSocketUriForLocalProxy(value);
}

/** @deprecated Prefer getWritablePostgresConnectionString — metadata/ownership only. */
export function getPostgresConnectionString(): string | undefined {
  return getWritablePostgresConnectionString();
}

/** True when this API is configured to query remote cloud Postgres without owning it. */
export function isCloudPostgresReadOnly(): boolean {
  return Boolean(getCloudPostgresConnectionString());
}

export function getVectorPostgresConnectionString(): string | undefined {
  if (preferCloudRetrieval()) {
    return (
      getCloudPostgresConnectionString() ??
      getWritablePostgresConnectionString()
    );
  }
  return getWritablePostgresConnectionString();
}

/**
 * Local personal: LibSQL + FastEmbed (default).
 * Cloud/global: PgVector + Gemini when a cloud or writable Postgres URI is set.
 */
export function getVectorBackend(): VectorBackend {
  const env = process.env.LEDGEINDEX_VECTOR_BACKEND?.toLowerCase();
  const envWantsPg =
    env === "pgvector" || env === "postgres" || env === "pg";

  if (preferCloudRetrieval()) {
    if (
      getCloudPostgresConnectionString() ||
      getWritablePostgresConnectionString() ||
      envWantsPg
    ) {
      return "pgvector";
    }
    return "libsql";
  }

  if (envWantsPg) return "pgvector";
  return "libsql";
}

export function getEmbeddingDimension(): number {
  return getVectorBackend() === "pgvector"
    ? PROD_EMBEDDING_DIMENSION
    : LOCAL_EMBEDDING_DIMENSION;
}

export function getLibSqlUrl(): string {
  return (
    process.env.LEDGEINDEX_LIBSQL_URL ??
    `file:${dataPath("ledgeindex-vector.db")}`
  );
}

/** Mastra / AI SDK expect GOOGLE_GENERATIVE_AI_API_KEY; accept GOOGLE_API_KEY alias. */
export function getGoogleGenerativeApiKey(): string | undefined {
  return (
    process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? process.env.GOOGLE_API_KEY
  );
}

export function hasGoogleGenerativeKey(): boolean {
  return Boolean(getGoogleGenerativeApiKey());
}

export function hasOpenAiKey(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

export function hasDeepSeekKey(): boolean {
  return Boolean(process.env.DEEPSEEK_API_KEY?.trim());
}

/** Any provider key that unlocks LLM rerank + agent answers. */
export function hasLlmKey(): boolean {
  return (
    hasGoogleGenerativeKey() ||
    hasOpenAiKey() ||
    hasDeepSeekKey() ||
    Boolean(process.env.LM_STUDIO_BASE_URL?.trim())
  );
}
