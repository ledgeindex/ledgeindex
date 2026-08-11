import type {
  IngestPipelineNode,
  IngestPipelineSnapshot,
  RefreshRunSnapshot,
} from "@/lib/ledgeindex-api";
import { IDLE_INGEST_PIPELINE } from "@/lib/ingest-pipeline";

function cloneIdle(): IngestPipelineNode[] {
  return IDLE_INGEST_PIPELINE.map((node) => ({ ...node }));
}

const PIPELINE_ORDER = ["crawl", "extract", "embed", "store"] as const;

function markNode(
  pipeline: IngestPipelineNode[],
  id: IngestPipelineNode["id"],
  status: IngestPipelineNode["status"],
  detail?: string,
) {
  const node = pipeline.find((entry) => entry.id === id);
  if (!node) return;
  node.status = status;
  if (detail) node.detail = detail;
}

/**
 * Map catalog ingest onto the shared strip.
 * Catalog auto-resumes review gates, so suspended crawl/extract means "work done,
 * waiting for our confirm" — show done and advance Indexing optimistically (same
 * idea as resolveDisplayPipeline busy=save on add-source).
 */
export function pipelineFromCatalogIngest(input: {
  snapshot: IngestPipelineSnapshot | null;
  crawlPages?: number | null;
  maxPages?: number;
}): IngestPipelineNode[] {
  const { snapshot, crawlPages = null, maxPages = 1000 } = input;

  // Drop enrich from the strip (catalog always skips example enrichment).
  const raw =
    snapshot?.pipeline && snapshot.pipeline.length > 0
      ? snapshot.pipeline
      : cloneIdle();
  const pipeline: IngestPipelineNode[] = PIPELINE_ORDER.map((id) => {
    const fromSnap = raw.find((node) => node.id === id);
    const idle = IDLE_INGEST_PIPELINE.find((node) => node.id === id)!;
    return fromSnap
      ? {
          id,
          label: idle.label,
          status: fromSnap.status,
          detail: fromSnap.detail,
          progress: fromSnap.progress,
        }
      : { ...idle };
  });

  // Review suspend = extraction finished; don't leave Extracting amber/active.
  for (const id of ["crawl", "extract"] as const) {
    const node = pipeline.find((entry) => entry.id === id);
    if (node?.status === "suspended") {
      node.status = "done";
      if (!node.detail || /waiting|review/i.test(node.detail)) {
        node.detail = id === "crawl" ? "Discovered" : "Extracted";
      }
    }
  }

  const livePhase = snapshot?.livePhase;
  if (livePhase === "extracting") {
    markNode(pipeline, "crawl", "done", pipeline[0]?.detail ?? "Discovered");
    markNode(pipeline, "extract", "running", pipeline[1]?.detail ?? "Extracting…");
  } else if (livePhase === "chunking" || livePhase === "embedding") {
    markNode(pipeline, "crawl", "done", pipeline[0]?.detail ?? "Discovered");
    markNode(pipeline, "extract", "done", pipeline[1]?.detail ?? "Extracted");
    markNode(
      pipeline,
      "embed",
      "running",
      pipeline[2]?.detail ?? "Chunking + indexing…",
    );
  } else if (livePhase === "storing") {
    markNode(pipeline, "crawl", "done", pipeline[0]?.detail ?? "Discovered");
    markNode(pipeline, "extract", "done", pipeline[1]?.detail ?? "Extracted");
    markNode(pipeline, "embed", "done", pipeline[2]?.detail ?? "Indexed");
    markNode(pipeline, "store", "running", pipeline[3]?.detail ?? "Saving…");
  }

  const crawl = pipeline.find((node) => node.id === "crawl");
  const anyLaterActive = pipeline.some(
    (node) =>
      node.id !== "crawl" &&
      (node.status === "running" || node.status === "done"),
  );

  // Only force crawl running while discovery is actually in progress.
  if (
    crawl &&
    !anyLaterActive &&
    crawl.status !== "done" &&
    crawl.status !== "error" &&
    (!snapshot ||
      crawl.status === "pending" ||
      crawl.status === "running" ||
      snapshot.status === "running")
  ) {
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

  if (typeof crawlPages === "number" && crawlPages >= 0 && crawl?.status === "running") {
    crawl.detail = `Discovered ${crawlPages} pages…`;
    crawl.progress = {
      current: crawlPages,
      total: Math.max(maxPages, crawlPages, 1),
      phase: crawl.progress?.phase,
    };
  }

  const hasRunning = pipeline.some((node) => node.status === "running");
  const workflowBusy =
    !snapshot ||
    snapshot.status === "running" ||
    snapshot.status === "suspended" ||
    Boolean(snapshot.suspendedStep);

  // Gap after extract suspend / before embed reports live progress: show Indexing.
  if (workflowBusy && !hasRunning && snapshot?.status !== "success") {
    const next = PIPELINE_ORDER.find((id) => {
      const node = pipeline.find((entry) => entry.id === id);
      return node && node.status !== "done" && node.status !== "error";
    });
    if (next === "embed") {
      markNode(pipeline, "embed", "running", "Starting indexing…");
    } else if (next === "store") {
      markNode(pipeline, "store", "running", "Saving…");
    } else if (next === "extract") {
      markNode(pipeline, "extract", "running", "Extracting…");
    } else if (next === "crawl") {
      markNode(pipeline, "crawl", "running", crawl?.detail ?? "Discovering…");
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
