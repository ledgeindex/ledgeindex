import type { IngestPipelineNode } from "@/lib/ledgeindex-api";

type LegacyPipelineNode = Omit<IngestPipelineNode, "id"> & {
  id: IngestPipelineNode["id"] | "index";
};

export const IDLE_INGEST_PIPELINE: IngestPipelineNode[] = [
  { id: "crawl", label: "Crawling", status: "pending", detail: "Waiting" },
  {
    id: "filter",
    label: "Filtering",
    status: "pending",
    detail: "HTTP errors · optional version filters",
  },
  { id: "extract", label: "Extracting", status: "pending", detail: "Waiting" },
  { id: "embed", label: "Indexing", status: "pending", detail: "Waiting" },
  { id: "store", label: "Storing", status: "pending", detail: "Waiting" },
];

function idleNode(id: IngestPipelineNode["id"]): IngestPipelineNode {
  return (
    IDLE_INGEST_PIPELINE.find((node) => node.id === id) ?? {
      id,
      label: id,
      status: "pending",
      detail: "Waiting",
    }
  );
}

/** Ensure the display strip always has Filtering after Crawling (UI-only step). */
function ensureFilterStep(nodes: IngestPipelineNode[]): IngestPipelineNode[] {
  if (nodes.some((node) => node.id === "filter")) return nodes;

  const crawlIndex = nodes.findIndex((node) => node.id === "crawl");
  const filter = { ...idleNode("filter") };
  if (crawlIndex < 0) return [filter, ...nodes];

  return [
    ...nodes.slice(0, crawlIndex + 1),
    filter,
    ...nodes.slice(crawlIndex + 1),
  ];
}

function normalizePipeline(
  nodes: LegacyPipelineNode[],
): IngestPipelineNode[] {
  const hasLegacyIndex = nodes.some((node) => node.id === "index");
  if (!hasLegacyIndex) {
    return ensureFilterStep(nodes as IngestPipelineNode[]);
  }

  const index = nodes.find((node) => node.id === "index");
  const crawl = nodes.find((node) => node.id === "crawl") ?? idleNode("crawl");
  const extract =
    nodes.find((node) => node.id === "extract") ?? idleNode("extract");
  const embedIdle = idleNode("embed");
  const storeIdle = idleNode("store");
  const embed =
    nodes.find((node) => node.id === "embed") ??
    ({
      ...embedIdle,
      status: index?.status ?? "pending",
      detail:
        index?.status === "running"
          ? "Chunking + indexing…"
          : index?.status === "done"
            ? index.detail
            : "Waiting",
    } satisfies IngestPipelineNode);
  const store =
    nodes.find((node) => node.id === "store") ??
    ({
      ...storeIdle,
      status:
        index?.status === "done"
          ? "done"
          : index?.status === "running"
            ? "pending"
            : "pending",
      detail:
        index?.status === "done"
          ? index.detail?.replace(/stored/i, "indexed")
          : index?.status === "running"
            ? "Writing to index…"
            : "Waiting",
    } satisfies IngestPipelineNode);

  return ensureFilterStep([
    crawl as IngestPipelineNode,
    extract as IngestPipelineNode,
    embed as IngestPipelineNode,
    store as IngestPipelineNode,
  ]);
}

export type FilterPipelinePhase =
  | "idle"
  | "discovering"
  | "http"
  | "auto-exclude"
  | "done";

export function resolveDisplayPipeline(input: {
  snapshotPipeline: IngestPipelineNode[] | null | undefined;
  busy: string | null;
  discoveredCount: number;
  maxPages: number;
  selectedCount: number;
  extractedCount: number;
  chunkCount?: number;
  /** UI-only Filtering step (HTTP cleanup → optional auto-exclude). */
  filterPhase?: FilterPipelinePhase;
  filterDetail?: string;
  httpErrorCount?: number;
}): {
  pipeline: IngestPipelineNode[];
  headline: string;
} {
  const base = normalizePipeline(
    (input.snapshotPipeline && input.snapshotPipeline.length > 0
      ? input.snapshotPipeline
      : IDLE_INGEST_PIPELINE) as LegacyPipelineNode[],
  );

  const filterPhase = input.filterPhase ?? "idle";
  const filterRunning =
    filterPhase === "http" || filterPhase === "auto-exclude";
  const filterDone = filterPhase === "done";

  const pipeline = base.map((node) => {
    let status = node.status;
    let detail = node.detail;
    const progress = node.progress;

    const laterStepsStarted = base.some(
      (entry) =>
        (entry.id === "embed" || entry.id === "store") &&
        (entry.status === "running" || entry.status === "done"),
    );

    if (node.id === "extract" && laterStepsStarted && status === "suspended") {
      status = "done";
    }

    if (input.busy === "crawl" && node.id === "crawl" && !filterRunning) {
      status = "running";
      detail = `Scanning up to ${input.maxPages} pages…`;
    }

    if (node.id === "filter") {
      if (filterRunning) {
        status = "running";
        detail =
          input.filterDetail ??
          (filterPhase === "auto-exclude"
            ? "Filter versions (AI)…"
            : "Dropping non-2xx pages…");
      } else if (filterDone) {
        status = "done";
        detail =
          input.filterDetail ??
          (input.httpErrorCount != null
            ? `Removed ${input.httpErrorCount} error page${input.httpErrorCount === 1 ? "" : "s"}`
            : "URL cleanup done");
      } else if (input.busy === "crawl") {
        status = "pending";
        detail = "After discovery";
      } else if (
        status === "pending" &&
        (input.discoveredCount > 0 || input.busy === "parse" || input.busy === "save")
      ) {
        // Past crawl without an explicit filter pass (restored session, etc.)
        if (input.busy === "parse" || input.busy === "save") {
          status = "done";
          detail = "URL cleanup done";
        }
      }
    }

    // While Filtering runs, keep Crawling marked done so the strip advances.
    if (node.id === "crawl" && filterRunning) {
      status = "done";
      detail = `${input.discoveredCount} of ${input.maxPages} URLs discovered`;
    }

    if (input.busy === "parse" && node.id === "extract") {
      status = "running";
      detail =
        input.selectedCount > 0
          ? `Extracting 0 of ${input.selectedCount} pages…`
          : "Extracting pages…";
    }
    if (input.busy === "save") {
      const effectiveStatus = (id: IngestPipelineNode["id"]) => {
        const raw = base.find((entry) => entry.id === id)?.status ?? "pending";
        if (
          raw === "suspended" &&
          (id === "crawl" || id === "extract" || id === "filter")
        ) {
          return "done" as const;
        }
        if (id === "filter") return "done" as const;
        return raw;
      };

      const snapshotRunning = base.find((entry) => entry.status === "running")?.id;
      const optimisticRunning =
        snapshotRunning ??
        (["crawl", "filter", "extract", "embed", "store"] as const).find((id) => {
          const next = effectiveStatus(id);
          return next !== "done" && next !== "error";
        });

      if (node.id === optimisticRunning && status !== "done" && status !== "error") {
        status = "running";
        if (node.id === "extract") {
          if (progress && progress.total > 0) {
            detail = `Extracting page ${progress.current} / ${progress.total}`;
          } else {
            detail =
              input.selectedCount > 0
                ? `Extracting 0 of ${input.selectedCount} pages…`
                : "Extracting pages…";
          }
        } else if (node.id === "embed" && !node.detail?.includes("/")) {
          detail = "Chunking + indexing…";
        } else if (node.id === "store" && !node.detail?.includes("/")) {
          detail = detail ?? "Writing to index…";
        }
      }
    }

    if (node.id === "crawl") {
      if (status === "suspended" || status === "done") {
        detail = `${input.discoveredCount} of ${input.maxPages} URLs discovered`;
      } else if (status === "pending" && !input.busy) {
        detail = "Ready";
      }
    }

    if (node.id === "extract") {
      if (status === "suspended" || status === "done") {
        const total = Math.max(input.selectedCount, input.extractedCount, 1);
        detail = `${input.extractedCount} of ${total} pages extracted`;
      } else if (status === "pending" && !input.busy) {
        detail = input.selectedCount
          ? `${input.selectedCount} selected`
          : "Waiting";
      }
    }

    if (node.id === "store" && status === "done" && input.chunkCount != null) {
      detail = `${input.chunkCount} chunks indexed`;
    }

    return { ...node, status, detail, progress };
  });

  const active =
    pipeline.find((node) => node.status === "running") ??
    pipeline.find((node) => node.status === "suspended") ??
    pipeline.find((node) => node.status === "error");

  let headline = "Pipeline idle — run crawl preview to start";
  if (active?.status === "running") {
    headline = active.detail ?? `${active.label}…`;
  } else if (active?.status === "suspended") {
    headline = active.detail ?? `Review ${active.label.toLowerCase()}`;
  } else if (active?.status === "error") {
    headline = "Pipeline error";
  } else if (pipeline.every((node) => node.status === "done")) {
    headline = input.chunkCount
      ? `Indexed ${input.chunkCount} chunks`
      : "Pipeline complete";
  }

  return { pipeline, headline };
}
