import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dataPath } from "../lib/data-dir.js";

const REFRESH_RUNS_FILE = dataPath("refresh-runs.json");

export type RefreshPageRef = {
  url: string;
  title: string;
};

export type RefreshChangelog = {
  baselineCaptured: boolean;
  unchangedCount: number;
  added: RefreshPageRef[];
  updated: RefreshPageRef[];
  removed: RefreshPageRef[];
};

export type RefreshMode = "discover" | "selected";

export type RefreshRunStatus =
  | "discovering"
  | "parsing"
  | "comparing"
  | "ready"
  | "applying"
  | "done"
  | "cancelled"
  | "failed";

export type RefreshRunPhase =
  | "discovering"
  | "parsing"
  | "comparing"
  | "embedding"
  | "storing"
  | "done";

export type RefreshParsedPageCache = {
  title: string;
  markdown: string;
};

export type RefreshRunSnapshot = {
  runId: string;
  sourceId: string;
  crawlRunId: string;
  mode: RefreshMode;
  status: RefreshRunStatus;
  phase: RefreshRunPhase;
  current: number;
  total: number;
  /** Current start-path label while discovering multi-path sources (e.g. `/docs`). */
  activePath?: string;
  /** 1-based index of the start path currently being crawled. */
  pathIndex?: number;
  /** Total start paths in this refresh discover pass. */
  pathTotal?: number;
  changelog?: RefreshChangelog;
  /** Full discovered snapshot set from check — persisted only on apply. */
  pendingSnapshots?: Array<{ url: string; title: string; contentHash: string }>;
  /** Parsed markdown from check for added/updated URLs — reused on apply. */
  parsedPagesCache?: Record<string, RefreshParsedPageCache>;
  error?: string;
};

type PersistedRefreshRuns = Record<string, RefreshRunSnapshot>;

const activeBySource = new Map<string, RefreshRunSnapshot>();
const cancelRequested = new Set<string>();

function loadPersistedRuns(): PersistedRefreshRuns {
  try {
    return JSON.parse(readFileSync(REFRESH_RUNS_FILE, "utf8")) as PersistedRefreshRuns;
  } catch {
    return {};
  }
}

function persistRuns(snapshot: PersistedRefreshRuns) {
  writeFileSync(REFRESH_RUNS_FILE, JSON.stringify(snapshot, null, 2), "utf8");
}

function persistRefreshRun(run: RefreshRunSnapshot) {
  const snapshot = loadPersistedRuns();
  snapshot[run.sourceId] = run;
  persistRuns(snapshot);
}

function deletePersistedRefreshRun(sourceId: string) {
  const snapshot = loadPersistedRuns();
  if (!(sourceId in snapshot)) return;
  delete snapshot[sourceId];
  persistRuns(snapshot);
}

function loadPersistedRefreshRun(
  sourceId: string,
): RefreshRunSnapshot | null {
  const snapshot = loadPersistedRuns();
  return snapshot[sourceId] ?? null;
}

export function getActiveRefreshRun(
  sourceId: string,
): RefreshRunSnapshot | null {
  return activeBySource.get(sourceId) ?? loadPersistedRefreshRun(sourceId);
}

export function createRefreshRun(
  sourceId: string,
  crawlRunId: string,
  mode: RefreshMode = "discover",
) {
  const run: RefreshRunSnapshot = {
    runId: randomUUID(),
    sourceId,
    crawlRunId,
    mode,
    status: mode === "discover" ? "discovering" : "parsing",
    phase: mode === "discover" ? "discovering" : "parsing",
    current: 0,
    total: 0,
  };
  activeBySource.set(sourceId, run);
  cancelRequested.delete(sourceId);
  persistRefreshRun(run);
  return run;
}

export function patchRefreshRun(
  sourceId: string,
  patch: Partial<RefreshRunSnapshot>,
) {
  const current =
    activeBySource.get(sourceId) ?? loadPersistedRefreshRun(sourceId);
  if (!current) return null;
  const next = { ...current, ...patch };
  activeBySource.set(sourceId, next);
  persistRefreshRun(next);
  return next;
}

export function clearRefreshRun(sourceId: string) {
  activeBySource.delete(sourceId);
  cancelRequested.delete(sourceId);
  deletePersistedRefreshRun(sourceId);
}

export function requestRefreshCancellation(sourceId: string) {
  cancelRequested.add(sourceId);
}

export function isRefreshCancellationRequested(sourceId: string) {
  return cancelRequested.has(sourceId);
}

export function assertRefreshNotCancelled(sourceId: string) {
  if (isRefreshCancellationRequested(sourceId)) {
    throw new Error("Refresh cancelled");
  }
}

export function isRefreshRunInProgress(status: RefreshRunStatus): boolean {
  return (
    status === "discovering" ||
    status === "parsing" ||
    status === "comparing" ||
    status === "applying"
  );
}

export function canReuseRefreshRun(run: RefreshRunSnapshot): boolean {
  return isRefreshRunInProgress(run.status);
}
