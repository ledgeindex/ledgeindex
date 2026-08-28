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

/** Marks a hash as taken from indexed markdown, not an unapplied crawl. */
export const INDEXED_CONTENT_HASH_PREFIX = "idx:";

export function hashIndexedPageContent(markdown: string): string {
  return `${INDEXED_CONTENT_HASH_PREFIX}${hashPageContent(markdown)}`;
}

export function isIndexedPageHash(hash: string): boolean {
  return String(hash ?? "").startsWith(INDEXED_CONTENT_HASH_PREFIX);
}

/** Identity key for a page URL. Trailing slash, www, query, and hash do not count. */
export function pageSnapshotUrlKey(url: string): string {
  const trimmed = String(url ?? "").trim();
  if (!trimmed) return "";
  try {
    const parsed = new URL(trimmed);
    parsed.hash = "";
    parsed.search = "";
    const protocol = parsed.protocol.toLowerCase();
    const host = parsed.hostname.replace(/^www\./i, "").toLowerCase();
    const path = parsed.pathname.replace(/\/+$/, "") || "/";
    const port =
      parsed.port &&
      !(
        (protocol === "https:" && parsed.port === "443") ||
        (protocol === "http:" && parsed.port === "80")
      )
        ? `:${parsed.port}`
        : "";
    return `${protocol}//${host}${port}${path === "/" ? "" : path}`;
  } catch {
    return trimmed.replace(/\/+$/, "").toLowerCase();
  }
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

  const existingByKey = new Map(
    existing.map((page) => [pageSnapshotUrlKey(page.url), page]),
  );
  const incomingByKey = new Map(
    incoming.map((page) => [pageSnapshotUrlKey(page.url), page]),
  );

  const added: PageSnapshotInput[] = [];
  const updated: PageSnapshotInput[] = [];
  let unchangedCount = 0;

  for (const snapshot of incoming) {
    const prior = existingByKey.get(pageSnapshotUrlKey(snapshot.url));
    if (!prior || prior.tombstonedAt) {
      added.push(snapshot);
    } else if (prior.contentHash !== snapshot.contentHash) {
      updated.push(snapshot);
    } else {
      unchangedCount += 1;
    }
  }

  const removed = existing.filter(
    (page) =>
      page.tombstonedAt == null &&
      !incomingByKey.has(pageSnapshotUrlKey(page.url)),
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
  const incomingByKey = new Map(
    incoming.map((page) => [pageSnapshotUrlKey(page.url), page]),
  );
  const nextByKey = new Map<string, PageSnapshot>();

  for (const snapshot of incoming) {
    nextByKey.set(pageSnapshotUrlKey(snapshot.url), {
      url: snapshot.url,
      title: snapshot.title,
      contentHash: snapshot.contentHash,
      tombstonedAt: null,
    });
  }

  for (const page of existing) {
    const key = pageSnapshotUrlKey(page.url);
    if (!incomingByKey.has(key) && page.tombstonedAt == null) {
      nextByKey.set(key, {
        ...page,
        tombstonedAt: new Date().toISOString(),
      });
    }
  }

  return [...nextByKey.values()];
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
  const byKey = new Map(
    existing.map((page) => [pageSnapshotUrlKey(page.url), page]),
  );

  for (const snapshot of input.snapshots) {
    byKey.set(pageSnapshotUrlKey(snapshot.url), {
      url: snapshot.url,
      title: snapshot.title,
      contentHash: snapshot.contentHash,
      tombstonedAt: null,
    });
  }

  savePageSnapshotsToFile(input.sourceId, [...byKey.values()]);
}

export async function tombstonePageSnapshots(
  sourceId: string,
  urls: string[],
): Promise<void> {
  if (urls.length === 0) return;
  const keys = new Set(urls.map((url) => pageSnapshotUrlKey(url)).filter(Boolean));
  if (keys.size === 0) return;
  const now = new Date().toISOString();

  if (usePostgres()) {
    const db = getPool();
    if (!db) return;
    const existing = await listPageSnapshots(sourceId);
    const matchUrls = existing
      .filter((page) => keys.has(pageSnapshotUrlKey(page.url)))
      .map((page) => page.url);
    if (matchUrls.length === 0) return;
    await db.query(
      `UPDATE pages
       SET tombstoned_at = now(), updated_at = now()
       WHERE source_id = $1
         AND tombstoned_at IS NULL
         AND url = ANY($2::text[])`,
      [sourceId, matchUrls],
    );
    return;
  }

  const existing = listPageSnapshotsFromFile(sourceId);
  savePageSnapshotsToFile(
    sourceId,
    existing.map((page) =>
      keys.has(pageSnapshotUrlKey(page.url)) && page.tombstonedAt == null
        ? { ...page, tombstonedAt: now }
        : page,
    ),
  );
}
