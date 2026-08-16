-- LedgeIndex OSS — minimal metadata schema for local Postgres (PgStore).
-- Vector chunks are created by @mastra/pg (PgVector) on first ingest.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS projects (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  owner_user_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sources (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  slug text NOT NULL,
  slug_owner_key text NOT NULL,
  type text NOT NULL DEFAULT 'web_crawl',
  scope text NOT NULL DEFAULT 'personal',
  hosting text,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  og_image_url text,
  favicon_url text,
  source_metadata jsonb,
  indexed_at timestamptz,
  index_stats jsonb,
  canonical_url text,
  source_family_id uuid,
  version_number integer NOT NULL DEFAULT 1,
  version_label text,
  categories text[] NOT NULL DEFAULT '{}',
  display_order integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sources_slug_owner_idx
  ON sources (slug, slug_owner_key);

CREATE INDEX IF NOT EXISTS sources_project_id_idx
  ON sources (project_id);

CREATE INDEX IF NOT EXISTS sources_canonical_scope_idx
  ON sources (canonical_url, scope, slug_owner_key);

CREATE TABLE IF NOT EXISTS crawl_runs (
  id uuid PRIMARY KEY,
  source_id uuid NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  kind text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  pages_discovered integer NOT NULL DEFAULT 0,
  pages_processed integer NOT NULL DEFAULT 0,
  error text,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS crawl_runs_source_id_idx
  ON crawl_runs (source_id);

CREATE TABLE IF NOT EXISTS source_sets (
  id uuid PRIMARY KEY,
  owner_user_id text NOT NULL,
  name text NOT NULL,
  slug text NOT NULL,
  description text,
  source_ids uuid[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS source_sets_owner_slug_idx
  ON source_sets (owner_user_id, slug);
