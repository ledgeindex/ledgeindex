import type {
  IngestPipelineNode,
  IngestPipelineSnapshot,
  RefreshRunSnapshot,
} from "@/lib/ledgeindex-api";
import { IDLE_INGEST_PIPELINE } from "@/lib/ingest-pipeline";

function cloneIdle(): IngestPipelineNode[] {
  return IDLE_INGEST_PIPELINE.map((node) => ({ ...node }));
}

/** Map catalog ingest (or live crawl progress) onto the shared strip. */
export function pipelineFromCatalogIngest(input: {
  snapshot: IngestPipelineSnapshot | null;
  crawlPages?: number | null;
  maxPages?: number;
}): IngestPipelineNode[] {
  const { snapshot, crawlPages = null, maxPages = 1000 } = input;
  const pipeline =
    snapshot?.pipeline && snapshot.pipeline.length > 0
      ? snapshot.pipeline.map((node) => ({ ...node }))
      : cloneIdle();

  const crawl = pipeline.find((node) => node.id === "crawl");
  if (!crawl) return pipeline;

  const crawling =
    !snapshot ||
    crawl.status === "pending" ||
    crawl.status === "running" ||
    (snapshot.status === "running" && !snapshot.suspendedStep);

  if (crawling && crawl.status !== "done" && crawl.status !== "error") {
    crawl.status = "running";
    if (typeof crawlPages === "number" && crawlPages >= 0) {
      crawl.detail = `Discovered ${crawlPages} pages…`;
      crawl.progress = {
        current: crawlPages,
        total: Math.max(maxPages, crawlPages, 1),
        phase: crawl.progress?.phase,
      };
    } else if (!crawl.detail || crawl.detail === "Waiting") {
      crawl.detail = "Discovering…";
    }
  }

  return pipeline;
}

/** Map a source-refresh run onto the shared crawl → extract → index → store strip. */
export function pipelineFromRefreshSnapshot(
  snapshot: RefreshRunSnapshot | null,
): IngestPipelineNode[] {
  const pipeline = cloneIdle();
  if (!snapshot) return pipeline;

  const mark = (
    id: IngestPipelineNode["id"],
    status: IngestPipelineNode["status"],
    detail: string,
  ) => {
    const node = pipeline.find((entry) => entry.id === id);
    if (!node) return;
    node.status = status;
    node.detail = detail;
  };

  const progress =
    snapshot.total > 0
      ? { current: snapshot.current, total: snapshot.total }
      : undefined;

  if (snapshot.status === "failed") {
    mark("crawl", "error", snapshot.error || "Failed");
    return pipeline;
  }
  if (snapshot.status === "cancelled") {
    mark("crawl", "error", "Cancelled");
    return pipeline;
  }
  if (snapshot.status === "done") {
    for (const node of pipeline) {
      node.status = "done";
      node.detail = "Done";
    }
    return pipeline;
  }

  if (snapshot.status === "discovering") {
    const multiPath =
      Boolean(snapshot.activePath) &&
      typeof snapshot.pathTotal === "number" &&
      snapshot.pathTotal > 1;
    const pathLabel = multiPath
      ? `${snapshot.activePath} (${snapshot.pathIndex}/${snapshot.pathTotal})`
      : null;
    mark(
      "crawl",
      "running",
      pathLabel ? `Crawling ${pathLabel}` : "Discovering…",
    );
    if (progress) {
      pipeline[0]!.progress = {
        ...progress,
        phase: pathLabel ?? undefined,
      };
    }
    return pipeline;
  }

  if (snapshot.status === "parsing" || snapshot.status === "comparing") {
    mark("crawl", "done", "Discovered");
    mark(
      "extract",
      "running",
      snapshot.status === "comparing" ? "Comparing…" : "Parsing…",
    );
    if (progress) pipeline[1]!.progress = progress;
    return pipeline;
  }

  if (snapshot.status === "ready") {
    mark("crawl", "done", "Discovered");
    mark("extract", "done", "Compared");
    mark("embed", "pending", "Waiting to apply");
    mark("store", "pending", "Waiting");
    return pipeline;
  }

  if (snapshot.status === "applying") {
    mark("crawl", "done", "Discovered");
    mark("extract", "done", "Compared");
    if (snapshot.phase === "storing") {
      mark("embed", "done", "Embedded");
      mark("store", "running", "Saving…");
      if (progress) pipeline[3]!.progress = progress;
    } else {
      mark("embed", "running", "Embedding…");
      mark("store", "pending", "Waiting");
      if (progress) pipeline[2]!.progress = progress;
    }
    return pipeline;
  }

  return pipeline;
}

export function refreshHasChanges(snapshot: RefreshRunSnapshot): boolean {
  const changelog = snapshot.changelog;
  if (!changelog) return false;
  if (changelog.baselineCaptured) return false;
  return (
    changelog.added.length > 0 ||
    changelog.updated.length > 0 ||
    changelog.removed.length > 0
  );
}
