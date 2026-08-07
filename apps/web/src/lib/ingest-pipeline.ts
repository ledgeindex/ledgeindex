import type { IngestPipelineNode } from "@/lib/ledgeindex-api";

type LegacyPipelineNode = Omit<IngestPipelineNode, "id"> & {
  id: IngestPipelineNode["id"] | "index";
};

export const IDLE_INGEST_PIPELINE: IngestPipelineNode[] = [
  { id: "crawl", label: "Crawling", status: "pending", detail: "Waiting" },
  { id: "extract", label: "Extracting", status: "pending", detail: "Waiting" },
  { id: "embed", label: "Indexing", status: "pending", detail: "Waiting" },
  { id: "store", label: "Storing", status: "pending", detail: "Waiting" },
];

function normalizePipeline(
  nodes: LegacyPipelineNode[],
): IngestPipelineNode[] {
  const hasLegacyIndex = nodes.some((node) => node.id === "index");
  if (!hasLegacyIndex) {
    return nodes as IngestPipelineNode[];
  }

  const index = nodes.find((node) => node.id === "index");
  const crawl =
    nodes.find((node) => node.id === "crawl") ?? IDLE_INGEST_PIPELINE[0]!;
  const extract =
    nodes.find((node) => node.id === "extract") ?? IDLE_INGEST_PIPELINE[1]!;
  const embed =
    nodes.find((node) => node.id === "embed") ??
    ({
      ...IDLE_INGEST_PIPELINE[2]!,
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
      ...IDLE_INGEST_PIPELINE[3]!,
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

  return [
    crawl as IngestPipelineNode,
    extract as IngestPipelineNode,
    embed as IngestPipelineNode,
    store as IngestPipelineNode,
  ];
}

export function resolveDisplayPipeline(input: {
  snapshotPipeline: IngestPipelineNode[] | null | undefined;
  busy: string | null;
  discoveredCount: number;
  maxPages: number;
  selectedCount: number;
  extractedCount: number;
  chunkCount?: number;
}): {
  pipeline: IngestPipelineNode[];
  headline: string;
} {
  const base = normalizePipeline(
    (input.snapshotPipeline && input.snapshotPipeline.length > 0
      ? input.snapshotPipeline
      : IDLE_INGEST_PIPELINE) as LegacyPipelineNode[],
  );

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

    if (input.busy === "crawl" && node.id === "crawl") {
      status = "running";
      detail = `Scanning up to ${input.maxPages} pages…`;
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
        // After Index & save, review gates are already confirmed — don't stall on suspended crawl/extract.
        if (raw === "suspended" && (id === "crawl" || id === "extract")) {
          return "done" as const;
        }
        return raw;
      };

      const snapshotRunning = base.find((entry) => entry.status === "running")?.id;
      const optimisticRunning =
        snapshotRunning ??
        (["crawl", "extract", "embed", "store"] as const).find((id) => {
          const status = effectiveStatus(id);
          return status !== "done" && status !== "error";
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
