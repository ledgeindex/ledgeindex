import type {
  RefreshChangelog,
  RefreshMode,
  RefreshRunSnapshot,
} from "@ledgeindex/docs/runtime/refresh/active-refresh-runs.js";
import {
  applySourceRefresh,
  getSourceRefreshStatus,
  startSourceRefreshCheck,
} from "@ledgeindex/docs/runtime/services/source-refresh.js";
import { resolveSourceRef } from "./sources.js";

/** @deprecated Use {@link UpdatesProgressUpdate} */
export type RefreshProgressUpdate = UpdatesProgressUpdate;

export type UpdatesProgressUpdate = {
  phase: RefreshRunSnapshot["phase"];
  status: RefreshRunSnapshot["status"];
  current: number;
  total: number;
  activePath?: string;
  pathIndex?: number;
  pathTotal?: number;
  changelog?: RefreshChangelog;
};

export type SourceUpdatesChangelog = RefreshChangelog;

export type CheckForUpdatesOptions = {
  /** Source id, slug, or name token. */
  source: string;
  /** `probe` = HEAD + sitemap (lightweight). `discover` = full re-crawl. `selected` = re-fetch all indexed URLs. */
  mode?: RefreshMode;
  onProgress?: (update: UpdatesProgressUpdate) => void;
  pollIntervalMs?: number;
};

export type CheckForUpdatesResult = {
  sourceId: string;
  runId: string;
  mode: RefreshMode;
  changelog: SourceUpdatesChangelog;
  hasChanges: boolean;
};

export type ApplyUpdatesOptions = {
  /** Source id, slug, or name token. */
  source: string;
  onProgress?: (update: UpdatesProgressUpdate) => void;
  pollIntervalMs?: number;
};

export type ApplyUpdatesResult = {
  sourceId: string;
  runId: string;
  changelog: SourceUpdatesChangelog;
};

function snapshotToProgress(
  snapshot: RefreshRunSnapshot,
): UpdatesProgressUpdate {
  return {
    phase: snapshot.phase,
    status: snapshot.status,
    current: snapshot.current,
    total: snapshot.total,
    activePath: snapshot.activePath,
    pathIndex: snapshot.pathIndex,
    pathTotal: snapshot.pathTotal,
    changelog: snapshot.changelog,
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hasChanges(changelog: SourceUpdatesChangelog): boolean {
  return (
    changelog.added.length > 0 ||
    changelog.updated.length > 0 ||
    changelog.removed.length > 0
  );
}

async function pollRefreshUntil(
  sourceId: string,
  predicate: (snapshot: RefreshRunSnapshot) => boolean,
  onProgress?: (update: UpdatesProgressUpdate) => void,
  pollIntervalMs = 500,
): Promise<RefreshRunSnapshot> {
  for (;;) {
    const snapshot = getSourceRefreshStatus(sourceId);
    if (!snapshot) {
      throw new Error("Update check run disappeared");
    }
    onProgress?.(snapshotToProgress(snapshot));
    if (predicate(snapshot)) {
      return snapshot;
    }
    await sleep(pollIntervalMs);
  }
}

/** Compare live site content to the index. Does not change the index. */
export async function checkForUpdates(
  options: CheckForUpdatesOptions,
): Promise<CheckForUpdatesResult> {
  const { sourceId } = await resolveSourceRef(options.source);

  const mode = options.mode ?? "probe";
  const pollIntervalMs = options.pollIntervalMs ?? 500;
  const onProgress = options.onProgress;

  await startSourceRefreshCheck(sourceId, { mode });

  const ready = await pollRefreshUntil(
    sourceId,
    (snapshot) =>
      snapshot.status === "ready" ||
      snapshot.status === "failed" ||
      snapshot.status === "cancelled",
    onProgress,
    pollIntervalMs,
  );

  if (ready.status === "failed") {
    throw new Error(ready.error ?? "Update check failed");
  }
  if (ready.status === "cancelled") {
    throw new Error("Update check cancelled");
  }
  if (!ready.changelog) {
    throw new Error("Update check completed without changelog");
  }

  return {
    sourceId,
    runId: ready.runId,
    mode: ready.mode,
    changelog: ready.changelog,
    hasChanges: hasChanges(ready.changelog),
  };
}

/** Apply a pending {@link checkForUpdates} result. Re-indexes changed pages and removes deleted ones. */
export async function applyUpdates(
  options: ApplyUpdatesOptions,
): Promise<ApplyUpdatesResult> {
  const { sourceId } = await resolveSourceRef(options.source);
  const pollIntervalMs = options.pollIntervalMs ?? 500;
  const onProgress = options.onProgress;

  const pending = getSourceRefreshStatus(sourceId);
  if (!pending || pending.status !== "ready" || !pending.changelog) {
    throw new Error(
      "No pending updates for this source. Run checkForUpdates first.",
    );
  }

  const changelog = pending.changelog;
  if (!hasChanges(changelog)) {
    return {
      sourceId,
      runId: pending.runId,
      changelog,
    };
  }

  await applySourceRefresh(sourceId);

  const done = await pollRefreshUntil(
    sourceId,
    (snapshot) =>
      snapshot.status === "done" ||
      snapshot.status === "failed" ||
      snapshot.status === "cancelled",
    onProgress,
    pollIntervalMs,
  );

  if (done.status === "failed") {
    throw new Error(done.error ?? "Failed to apply updates");
  }
  if (done.status === "cancelled") {
    throw new Error("Apply updates cancelled");
  }

  return {
    sourceId,
    runId: pending.runId,
    changelog,
  };
}
