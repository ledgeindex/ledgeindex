import type { WorkflowState } from "@mastra/core/workflows";
import type { IngestWorkflowRunSnapshot } from "./ingest-workflow-snapshot.js";
import {
  getIngestStepProgress,
  type IngestStepProgress,
} from "./active-runs.js";
import {
  CRAWL_REVIEW_STEP_ID,
  EMBED_STEP_ID,
  ENRICH_STEP_ID,
  PARSE_REVIEW_STEP_ID,
  STORE_STEP_ID,
} from "../mastra/workflows/ingest-web-crawl/schemas.js";

export type PipelineNodeId = "crawl" | "extract" | "enrich" | "embed" | "store";

export type PipelineNodeStatus =
  | "pending"
  | "running"
  | "done"
  | "suspended"
  | "error";

export type PipelineNodeState = {
  id: PipelineNodeId;
  label: string;
  status: PipelineNodeStatus;
  detail?: string;
  progress?: {
    current: number;
    total: number;
    phase?: string;
  };
};

export type IngestPipelineSnapshot = {
  runId: string;
  status: WorkflowState["status"] | "idle";
  /** False after crawl review when user disabled example enrichment. */
  enrichExamples?: boolean;
  suspendedStep?: string;
  suspendPayload?: unknown;
  /** Live enrich preview while the enrich step is still running. */
  liveEnrichPages?: unknown[];
  liveEnrichCount?: number;
  /** Active ingest progress phase from the server (extracting/enriching/…). */
  livePhase?: IngestStepProgress["phase"];
  liveProgress?: {
    current: number;
    total: number;
    sectionCurrent?: number;
    sectionTotal?: number;
    sectionUrl?: string;
  };
  result?: unknown;
  error?: string;
  pipeline: PipelineNodeState[];
};

type PipelineNodeDef = { id: PipelineNodeId; label: string; stepId: string };

const PIPELINE_NODES: PipelineNodeDef[] = [
  { id: "crawl", label: "Crawling", stepId: CRAWL_REVIEW_STEP_ID },
  { id: "extract", label: "Extracting", stepId: PARSE_REVIEW_STEP_ID },
  { id: "enrich", label: "Enriching", stepId: ENRICH_STEP_ID },
  { id: "embed", label: "Indexing", stepId: EMBED_STEP_ID },
  { id: "store", label: "Storing", stepId: STORE_STEP_ID },
];

function getStepEntry(
  stepId: string,
  steps: WorkflowState["steps"] | undefined,
) {
  const raw = steps?.[stepId];
  return Array.isArray(raw) ? raw[0] : raw;
}

function stepStatus(
  stepId: string,
  steps: WorkflowState["steps"] | undefined,
  workflowStatus: WorkflowState["status"],
): PipelineNodeStatus {
  const entry = getStepEntry(stepId, steps);

  if (!entry) {
    return "pending";
  }

  if (entry.status === "failed") return "error";
  if (entry.status === "suspended") return "suspended";
  if (entry.status === "running" || entry.status === "waiting") return "running";
  if (entry.status === "success") return "done";

  if (workflowStatus === "running") return "running";
  return "pending";
}

function formatStepProgress(
  stepId: string,
  sourceId: string | undefined,
): { detail?: string; progress?: PipelineNodeState["progress"] } {
  if (!sourceId) return {};
  const live = getIngestStepProgress(sourceId);
  if (!live || live.stepId !== stepId || live.total <= 0) return {};

  const progress = {
    current: live.current,
    total: live.total,
    phase: live.phase,
  };

  if (live.phase === "extracting") {
    return {
      progress,
      detail: `Extracting page ${live.current} / ${live.total}`,
    };
  }
  if (live.phase === "enriching") {
    const withExamples =
      typeof live.enrichedCount === "number" && live.enrichedCount > 0
        ? ` · ${live.enrichedCount} with examples`
        : "";
    const sectionPart =
      typeof live.sectionCurrent === "number" &&
      typeof live.sectionTotal === "number" &&
      live.sectionTotal > 1
        ? ` · section ${live.sectionCurrent}/${live.sectionTotal}`
        : "";
    return {
      progress,
      detail: `Enriching page ${live.current} / ${live.total}${sectionPart}${withExamples}`,
    };
  }
  if (live.phase === "chunking") {
    return {
      progress,
      detail: `Chunking page ${live.current} / ${live.total}`,
    };
  }
  if (live.phase === "embedding") {
    return {
      progress,
      detail: `Indexing ${live.current} / ${live.total} chunks`,
    };
  }
  return {
    progress,
    detail: `Storing ${live.current} / ${live.total} chunks`,
  };
}

function stepDetail(
  stepId: string,
  steps: WorkflowState["steps"] | undefined,
  sourceId?: string,
): string | undefined {
  const entry = getStepEntry(stepId, steps);
  const liveProgress = formatStepProgress(stepId, sourceId);
  const entryActive =
    !entry || entry.status === "running" || entry.status === "waiting";

  // Never resurface stale live counters after a step has finished / suspended.
  if (liveProgress.detail && entryActive) {
    return liveProgress.detail;
  }

  if (!entry) return undefined;

  if (stepId === CRAWL_REVIEW_STEP_ID) {
    const payload = entry.suspendPayload as
      | { pagesDiscovered?: number }
      | undefined;
    if (payload?.pagesDiscovered != null) {
      return `${payload.pagesDiscovered} URLs discovered`;
    }
  }

  if (stepId === PARSE_REVIEW_STEP_ID) {
    const payload = entry.suspendPayload as { pages?: unknown[] } | undefined;
    if (payload?.pages) {
      return `${payload.pages.length} pages parsed`;
    }
    if (entry.output) {
      const output = entry.output as { pages?: unknown[] };
      if (output.pages) {
        return `${output.pages.length} pages parsed`;
      }
    }
  }

  if (stepId === ENRICH_STEP_ID) {
    if (entry.status === "running" || entry.status === "waiting") {
      return "Enriching pages…";
    }
    if (entry.status === "suspended") {
      const payload = entry.suspendPayload as
        | { pages?: unknown[]; enrichedCount?: number }
        | undefined;
      if (payload?.enrichedCount != null && payload.pages) {
        return `${payload.enrichedCount}/${payload.pages.length} pages with examples`;
      }
      if (payload?.pages) {
        return `${payload.pages.length} pages enriched`;
      }
    }
    if (entry.output) {
      const output = entry.output as {
        pages?: Array<{ enrichment?: { status?: string } }>;
      };
      if (output.pages) {
        const n = output.pages.filter(
          (p) => p.enrichment?.status === "enriched",
        ).length;
        return `${n}/${output.pages.length} pages with examples`;
      }
    }
  }

  if (stepId === EMBED_STEP_ID) {
    if (entry.status === "running" || entry.status === "waiting") {
      return "Chunking + indexing…";
    }
    if (entry.output) {
      const output = entry.output as { prepared?: unknown[] };
      if (output.prepared) {
        return `${output.prepared.length} chunks prepared`;
      }
    }
  }

  if (stepId === STORE_STEP_ID) {
    if (entry.status === "running" || entry.status === "waiting") {
      return "Writing to index…";
    }
    if (entry.output) {
      const output = entry.output as { chunkCount?: number };
      if (output.chunkCount != null) {
        return `${output.chunkCount} chunks indexed`;
      }
    }
  }

  return undefined;
}

function stepProgress(
  stepId: string,
  steps: WorkflowState["steps"] | undefined,
  sourceId?: string,
): PipelineNodeState["progress"] | undefined {
  const entry = getStepEntry(stepId, steps);
  const entryActive =
    !entry || entry.status === "running" || entry.status === "waiting";
  if (!entryActive) return undefined;
  return formatStepProgress(stepId, sourceId).progress;
}

function livePhaseToNodeId(
  phase: IngestStepProgress["phase"] | undefined,
): PipelineNodeId | undefined {
  if (phase === "extracting") return "extract";
  if (phase === "enriching") return "enrich";
  if (phase === "chunking" || phase === "embedding") return "embed";
  if (phase === "storing") return "store";
  return undefined;
}

function enrichExamplesFromWorkflowState(
  state: IngestWorkflowRunSnapshot,
): boolean {
  const workflowState = state.initialState as
    | { enrichExamples?: boolean }
    | undefined;
  return workflowState?.enrichExamples === true;
}

export function buildPipelineSnapshot(input: {
  runId: string;
  state: IngestWorkflowRunSnapshot;
  sourceId?: string;
}): IngestPipelineSnapshot {
  const { runId, state, sourceId } = input;
  const steps = state.steps;
  const enrichExamples = enrichExamplesFromWorkflowState(state);
  const pipelineNodes = enrichExamples
    ? PIPELINE_NODES
    : PIPELINE_NODES.filter((node) => node.id !== "enrich");

  let suspendedStep: string | undefined;
  let suspendPayload: unknown;

  const live = sourceId ? getIngestStepProgress(sourceId) : null;
  let liveNodeId = livePhaseToNodeId(live?.phase);
  if (!enrichExamples && liveNodeId === "enrich") {
    liveNodeId = undefined;
  }
  // While a later step is live (e.g. enriching), ignore earlier suspend gates left in lastState.
  const liveBlocksEarlierSuspend =
    liveNodeId === "enrich" ||
    liveNodeId === "embed" ||
    liveNodeId === "store";

  for (const node of pipelineNodes) {
    const entry = getStepEntry(node.stepId, steps);
    if (entry?.status === "suspended") {
      if (
        liveBlocksEarlierSuspend &&
        (node.id === "crawl" || node.id === "extract")
      ) {
        continue;
      }
      if (liveNodeId === "enrich" && node.id === "enrich") {
        // Live enrich progress means we haven't hit the review gate yet.
        continue;
      }
      suspendedStep = node.stepId;
      suspendPayload = entry.suspendPayload;
      break;
    }
  }

  const liveStepId = liveNodeId
    ? pipelineNodes.find((node) => node.id === liveNodeId)?.stepId
    : undefined;
  const liveEntry = liveStepId ? getStepEntry(liveStepId, steps) : undefined;
  const liveIsStale =
    liveEntry?.status === "success" || liveEntry?.status === "suspended";
  const activeLiveNodeId = liveIsStale ? undefined : liveNodeId;

  const pipeline = pipelineNodes.map((node) => {
    let status = stepStatus(node.stepId, steps, state.status);
    if (activeLiveNodeId) {
      if (node.id === activeLiveNodeId) {
        status = "running";
      } else if (
        status === "running" &&
        pipelineNodes.findIndex((n) => n.id === node.id) <
          pipelineNodes.findIndex((n) => n.id === activeLiveNodeId)
      ) {
        status = "done";
      }
    }
    return {
      id: node.id,
      label: node.label,
      status,
      detail: stepDetail(node.stepId, steps, sourceId),
      progress: stepProgress(node.stepId, steps, sourceId),
    };
  });

  const liveEnrichPages =
    enrichExamples &&
    live?.phase === "enriching" &&
    !liveIsStale &&
    Array.isArray(live.previewPages)
      ? live.previewPages
      : undefined;
  const liveEnrichCount =
    enrichExamples &&
    live?.phase === "enriching" &&
    !liveIsStale &&
    typeof live.enrichedCount === "number"
      ? live.enrichedCount
      : undefined;

  return {
    runId,
    status: state.status,
    enrichExamples,
    suspendedStep,
    suspendPayload,
    ...(liveEnrichPages ? { liveEnrichPages } : {}),
    ...(liveEnrichCount != null ? { liveEnrichCount } : {}),
    ...(live?.phase && !liveIsStale
      ? {
          livePhase: live.phase,
          liveProgress: {
            current: live.current,
            total: live.total,
            ...(typeof live.sectionCurrent === "number"
              ? { sectionCurrent: live.sectionCurrent }
              : {}),
            ...(typeof live.sectionTotal === "number"
              ? { sectionTotal: live.sectionTotal }
              : {}),
            ...(typeof live.sectionUrl === "string" && live.sectionUrl
              ? { sectionUrl: live.sectionUrl }
              : {}),
          },
        }
      : {}),
    result: state.status === "success" ? state.result : undefined,
    error:
      state.status === "failed"
        ? (state.error?.message ?? "Workflow failed")
        : undefined,
    pipeline,
  };
}
