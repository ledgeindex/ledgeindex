// @ts-nocheck
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import type { Pool } from "pg";
import { createPgPool } from "./pg-store.js";
import { dataPath } from "../lib/data-dir.js";

const SNAPSHOT_FILE = dataPath("page-snapshots.json");

export type PageSnapshot = {
  url: string;
  title: string;
  contentHash: string;
  tombstonedAt: string | null;
};

export type PageSnapshotInput = {
  url: string;
  title: string;
  contentHash: string;
};

type PageSnapshotSnapshot = Record<string, PageSnapshot[]>;

let pool: Pool | null | undefined;

function getPool(): Pool | null {
  if (pool === undefined) {
    pool = createPgPool();
  }
  return pool;
}

function usePostgres(): boolean {
  return getPool() != null;
}

export function hashPageContent(markdown: string): string {
  return createHash("sha256").update(markdown.trim()).digest("hex");
}

export function isPageSnapshotStoreAvailable(): boolean {
  return true;
}

function loadSnapshotFile(): PageSnapshotSnapshot {
  try {
    return JSON.parse(readFileSync(SNAPSHOT_FILE, "utf8")) as PageSnapshotSnapshot;
  } catch {
    return {};
  }
}

function persistSnapshotFile(snapshot: PageSnapshotSnapshot) {
  writeFileSync(SNAPSHOT_FILE, JSON.stringify(snapshot, null, 2), "utf8");
}

function listPageSnapshotsFromFile(sourceId: string): PageSnapshot[] {
  const snapshot = loadSnapshotFile();
  return snapshot[sourceId] ?? [];
}

function savePageSnapshotsToFile(
  sourceId: string,
  pages: PageSnapshot[],
): PageSnapshot[] {
  const snapshot = loadSnapshotFile();
  snapshot[sourceId] = pages;
  persistSnapshotFile(snapshot);
  return pages;
}

function compareSnapshots(
  existing: PageSnapshot[],
  incoming: PageSnapshotInput[],
): {
  added: PageSnapshotInput[];
  updated: PageSnapshotInput[];
  removed: PageSnapshot[];
  unchangedCount: number;
  baselineCaptured: boolean;
} {
  const hadBaseline = existing.some(
    (page) => page.contentHash && page.tombstonedAt == null,
  );

  const existingByUrl = new Map(existing.map((page) => [page.url, page]));
  const incomingByUrl = new Map(incoming.map((page) => [page.url, page]));

  const added: PageSnapshotInput[] = [];
  const updated: PageSnapshotInput[] = [];
  let unchangedCount = 0;

  for (const snapshot of incoming) {
    const prior = existingByUrl.get(snapshot.url);
    if (!prior || prior.tombstonedAt) {
      added.push(snapshot);
    } else if (prior.contentHash !== snapshot.contentHash) {
      updated.push(snapshot);
    } else {
      unchangedCount += 1;
    }
  }

  const removed = existing.filter(
    (page) => page.tombstonedAt == null && !incomingByUrl.has(page.url),
  );

  return {
    added,
    updated,
    removed,
    unchangedCount,
    baselineCaptured: !hadBaseline,
  };
}

function buildNextSnapshots(
  existing: PageSnapshot[],
  incoming: PageSnapshotInput[],
): PageSnapshot[] {
  const incomingByUrl = new Map(incoming.map((page) => [page.url, page]));
  const nextByUrl = new Map<string, PageSnapshot>();

  for (const snapshot of incoming) {
    nextByUrl.set(snapshot.url, {
      url: snapshot.url,
      title: snapshot.title,
      contentHash: snapshot.contentHash,
      tombstonedAt: null,
    });
  }

  for (const page of existing) {
    if (!incomingByUrl.has(page.url) && page.tombstonedAt == null) {
      nextByUrl.set(page.url, {
        ...page,
        tombstonedAt: new Date().toISOString(),
      });
    }
  }

  return [...nextByUrl.values()];
}

export async function listPageSnapshots(
  sourceId: string,
): Promise<PageSnapshot[]> {
  const db = getPool();
  if (db) {
    const { rows } = await db.query<{
      url: string;
      title: string | null;
      content_hash: string | null;
      tombstoned_at: Date | null;
    }>(
      `SELECT url, title, content_hash, tombstoned_at
       FROM pages
       WHERE source_id = $1`,
      [sourceId],
    );

    return rows.map((row) => ({
      url: row.url,
      title: row.title ?? row.url,
      contentHash: row.content_hash ?? "",
      tombstonedAt: row.tombstoned_at?.toISOString() ?? null,
    }));
  }

  return listPageSnapshotsFromFile(sourceId);
}

async function applyPageSnapshotRefreshToPostgres(input: {
  sourceId: string;
  crawlRunId: string;
  snapshots: PageSnapshotInput[];
}) {
  const db = getPool();
  if (!db) {
    throw new Error("Page snapshots require Postgres");
  }

  const existing = await listPageSnapshots(input.sourceId);
  const comparison = compareSnapshots(existing, input.snapshots);

  const client = await db.connect();
  try {
    await client.query("BEGIN");

    for (const snapshot of input.snapshots) {
      await client.query(
        `INSERT INTO pages (
           id, source_id, url, title, content_hash, last_seen_run_id, tombstoned_at, updated_at
         )
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5::uuid, NULL, now())
         ON CONFLICT (source_id, url) DO UPDATE SET
           title = EXCLUDED.title,
           content_hash = EXCLUDED.content_hash,
           last_seen_run_id = EXCLUDED.last_seen_run_id,
           tombstoned_at = NULL,
           updated_at = now()`,
        [
          input.sourceId,
          snapshot.url,
          snapshot.title,
          snapshot.contentHash,
          input.crawlRunId,
        ],
      );
    }

    await client.query(
      `UPDATE pages
       SET tombstoned_at = now(), updated_at = now()
       WHERE source_id = $1
         AND tombstoned_at IS NULL
         AND NOT (url = ANY($2::text[]))`,
      [input.sourceId, input.snapshots.map((page) => page.url)],
    );

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  return {
    ...comparison,
    removed: comparison.removed.map((page) => ({
      url: page.url,
      title: page.title,
    })),
  };
}

function applyPageSnapshotRefreshToFile(input: {
  sourceId: string;
  snapshots: PageSnapshotInput[];
}) {
  const existing = listPageSnapshotsFromFile(input.sourceId);
  const comparison = compareSnapshots(existing, input.snapshots);
  const next = buildNextSnapshots(existing, input.snapshots);
  savePageSnapshotsToFile(input.sourceId, next);

  return {
    ...comparison,
    removed: comparison.removed.map((page) => ({
      url: page.url,
      title: page.title,
    })),
  };
}

export async function comparePageSnapshotRefresh(input: {
  sourceId: string;
  snapshots: PageSnapshotInput[];
}): Promise<{
  added: PageSnapshotInput[];
  updated: PageSnapshotInput[];
  removed: PageSnapshot[];
  unchangedCount: number;
  baselineCaptured: boolean;
}> {
  const existing = await listPageSnapshots(input.sourceId);
  const comparison = compareSnapshots(existing, input.snapshots);

  return {
    ...comparison,
    removed: comparison.removed.map((page) => ({
      url: page.url,
      title: page.title,
      contentHash: page.contentHash,
      tombstonedAt: page.tombstonedAt,
    })),
  };
}

export async function applyPageSnapshotRefresh(input: {
  sourceId: string;
  crawlRunId: string;
  snapshots: PageSnapshotInput[];
}): Promise<{
  added: PageSnapshotInput[];
  updated: PageSnapshotInput[];
  removed: PageSnapshot[];
  unchangedCount: number;
  baselineCaptured: boolean;
}> {
  if (usePostgres()) {
    return applyPageSnapshotRefreshToPostgres(input);
  }

  return applyPageSnapshotRefreshToFile(input);
}

/** Upsert hashes for specific URLs after apply — no tombstone sweep. */
export async function syncPageSnapshotHashes(input: {
  sourceId: string;
  crawlRunId: string;
  snapshots: PageSnapshotInput[];
}): Promise<void> {
  if (input.snapshots.length === 0) return;

  if (usePostgres()) {
    const db = getPool();
    if (!db) return;

    for (const snapshot of input.snapshots) {
      await db.query(
        `INSERT INTO pages (
           id, source_id, url, title, content_hash, last_seen_run_id, tombstoned_at, updated_at
         )
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5::uuid, NULL, now())
         ON CONFLICT (source_id, url) DO UPDATE SET
           title = EXCLUDED.title,
           content_hash = EXCLUDED.content_hash,
           last_seen_run_id = EXCLUDED.last_seen_run_id,
           tombstoned_at = NULL,
           updated_at = now()`,
        [
          input.sourceId,
          snapshot.url,
          snapshot.title,
          snapshot.contentHash,
          input.crawlRunId,
        ],
      );
    }
    return;
  }

  const existing = listPageSnapshotsFromFile(input.sourceId);
  const byUrl = new Map(existing.map((page) => [page.url, page]));

  for (const snapshot of input.snapshots) {
    byUrl.set(snapshot.url, {
      url: snapshot.url,
      title: snapshot.title,
      contentHash: snapshot.contentHash,
      tombstonedAt: null,
    });
  }

  savePageSnapshotsToFile(input.sourceId, [...byUrl.values()]);
}
