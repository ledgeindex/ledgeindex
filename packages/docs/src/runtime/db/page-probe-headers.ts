import { readFileSync, writeFileSync } from "node:fs";
import { dataPath } from "../lib/data-dir.js";

const PROBE_HEADERS_FILE = dataPath("page-probe-headers.json");

export type PageProbeHeaders = {
  etag?: string;
  lastModified?: string;
};

type ProbeHeadersSnapshot = Record<string, Record<string, PageProbeHeaders>>;

function loadSnapshot(): ProbeHeadersSnapshot {
  try {
    return JSON.parse(
      readFileSync(PROBE_HEADERS_FILE, "utf8"),
    ) as ProbeHeadersSnapshot;
  } catch {
    return {};
  }
}

function persistSnapshot(snapshot: ProbeHeadersSnapshot) {
  writeFileSync(PROBE_HEADERS_FILE, JSON.stringify(snapshot, null, 2), "utf8");
}

export function getPageProbeHeaders(
  sourceId: string,
  url: string,
): PageProbeHeaders | null {
  const snapshot = loadSnapshot();
  return snapshot[sourceId]?.[url] ?? null;
}

export function listPageProbeHeaders(
  sourceId: string,
): Record<string, PageProbeHeaders> {
  const snapshot = loadSnapshot();
  return snapshot[sourceId] ?? {};
}

export function setPageProbeHeadersForSource(
  sourceId: string,
  entries: Record<string, PageProbeHeaders>,
) {
  const snapshot = loadSnapshot();
  snapshot[sourceId] = entries;
  persistSnapshot(snapshot);
}

export function mergePageProbeHeaders(
  sourceId: string,
  updates: Record<string, PageProbeHeaders>,
) {
  const snapshot = loadSnapshot();
  const current = snapshot[sourceId] ?? {};
  snapshot[sourceId] = { ...current, ...updates };
  persistSnapshot(snapshot);
}
