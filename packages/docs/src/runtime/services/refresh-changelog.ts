import type { PageSnapshot, PageSnapshotInput } from "../db/page-snapshots.js";
import type { RefreshChangelog, RefreshPageRef } from "../refresh/active-refresh-runs.js";

function pageSnapshotUrlKey(url: string): string {
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

function resolveRefreshUrl(raw: string, origin: string): string {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("/") && origin) {
    try {
      return new URL(trimmed, origin).href;
    } catch {
      // fall through
    }
  }
  return trimmed;
}

export function pageRefreshUrlKey(url: string, origin = ""): string {
  const resolved = resolveRefreshUrl(url, origin);
  return pageSnapshotUrlKey(resolved || url);
}

export const INDEXED_CONTENT_HASH_PREFIX = "idx:";

export function isIndexedPageHash(hash: string): boolean {
  return String(hash ?? "").startsWith(INDEXED_CONTENT_HASH_PREFIX);
}

export function buildRefreshChangelog(input: {
  catalogPages: Array<{ url: string; title?: string }>;
  incoming: PageSnapshotInput[];
  existingSnapshots: Array<Pick<PageSnapshot, "url" | "contentHash" | "tombstonedAt">>;
  urlOrigin?: string;
}): RefreshChangelog {
  const origin = input.urlOrigin ?? "";

  if (input.catalogPages.length === 0) {
    const hadBaseline = input.existingSnapshots.some(
      (page) => page.contentHash && page.tombstonedAt == null,
    );
    if (!hadBaseline) {
      return {
        baselineCaptured: true,
        unchangedCount: 0,
        added: input.incoming.map((page) => ({ url: page.url, title: page.title })),
        updated: [],
        removed: [],
      };
    }
  }

  const incomingByKey = new Map<string, PageSnapshotInput>();
  for (const snapshot of input.incoming) {
    const key = pageRefreshUrlKey(snapshot.url, origin);
    if (key && !incomingByKey.has(key)) incomingByKey.set(key, snapshot);
  }

  const catalogByKey = new Map<string, { url: string; title: string }>();
  for (const page of input.catalogPages) {
    if (!page.url) continue;
    const key = pageRefreshUrlKey(page.url, origin);
    if (!key || catalogByKey.has(key)) continue;
    catalogByKey.set(key, {
      url: page.url,
      title: page.title?.trim() || page.url,
    });
  }

  const hashByKey = new Map<string, string>();
  for (const page of input.existingSnapshots) {
    if (!page.url || page.tombstonedAt || !isIndexedPageHash(page.contentHash)) {
      continue;
    }
    const key = pageRefreshUrlKey(page.url, origin);
    if (key && !hashByKey.has(key)) hashByKey.set(key, page.contentHash);
  }

  const added: RefreshPageRef[] = [];
  const updated: RefreshPageRef[] = [];
  let unchangedCount = 0;

  for (const [key, snapshot] of incomingByKey) {
    const indexed = catalogByKey.get(key);
    if (!indexed) {
      added.push({ url: snapshot.url, title: snapshot.title });
      continue;
    }

    const priorHash = hashByKey.get(key);
    if (
      priorHash &&
      isIndexedPageHash(snapshot.contentHash) &&
      priorHash === snapshot.contentHash
    ) {
      unchangedCount += 1;
      continue;
    }

    updated.push({
      url: snapshot.url,
      title: snapshot.title,
      indexedUrl: indexed.url !== snapshot.url ? indexed.url : undefined,
    });
  }

  const removed: RefreshPageRef[] = [];
  for (const [key, indexed] of catalogByKey) {
    if (incomingByKey.has(key)) continue;
    removed.push({ url: indexed.url, title: indexed.title });
  }

  return {
    baselineCaptured: false,
    added,
    updated,
    removed,
    unchangedCount,
  };
}

export function refreshDeleteUrls(changelog: RefreshChangelog): string[] {
  const urls = new Set<string>();
  for (const page of [...changelog.updated, ...changelog.removed, ...changelog.added]) {
    if (page.url) urls.add(page.url);
    if (page.indexedUrl) urls.add(page.indexedUrl);
  }
  return [...urls];
}
