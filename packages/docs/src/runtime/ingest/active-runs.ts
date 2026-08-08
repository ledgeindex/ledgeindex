import type { WorkflowState } from "@mastra/core/workflows";
import {
  CRAWL_REVIEW_STEP_ID,
  EMBED_STEP_ID,
  ENRICH_STEP_ID,
  PARSE_REVIEW_STEP_ID,
  STORE_STEP_ID,
} from "../mastra/workflows/ingest-web-crawl/schemas.js";
import { clearIngestCancellation } from "./ingest-cancel.js";
import type { IngestWorkflowRunSnapshot } from "./ingest-workflow-snapshot.js";

type WorkflowRunHandle = {
  runId: string;
  sourceId: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  run: any;
  lastState: IngestWorkflowRunSnapshot;
};

const activeRuns = new Map<string, WorkflowRunHandle>();

export function registerActiveIngestRun(handle: WorkflowRunHandle) {
  activeRuns.set(handle.runId, handle);
}

export function unregisterActiveIngestRun(runId: string) {
  const handle = activeRuns.get(runId);
  if (handle) {
    clearIngestStepProgress(handle.sourceId);
    clearIngestCancellation(handle.sourceId);
  }
  activeRuns.delete(runId);
}

export function getActiveIngestRun(runId: string) {
  return activeRuns.get(runId) ?? null;
}

export function getActiveIngestRunBySourceId(sourceId: string) {
  return (
    [...activeRuns.values()].find((handle) => handle.sourceId === sourceId) ??
    null
  );
}

export function listActiveIngestRunsForSource(sourceId: string): string[] {
  return [...activeRuns.values()]
    .filter((handle) => handle.sourceId === sourceId)
    .map((handle) => handle.runId);
}

export type IngestStepProgress = {
  stepId: string;
  phase: "extracting" | "enriching" | "chunking" | "embedding" | "storing";
  current: number;
  total: number;
  /** Pages successfully enriched so far (live preview while enrich runs). */
  enrichedCount?: number;
  previewPages?: unknown[];
  /** Sectioned enrich retry: 1-based section index currently running. */
  sectionCurrent?: number;
  sectionTotal?: number;
  /** Page URL currently being processed (extract / enrich / chunk). */
  sectionUrl?: string;
};

const stepProgressBySource = new Map<string, IngestStepProgress>();

export function setIngestStepProgress(
  sourceId: string,
  progress: IngestStepProgress,
) {
  stepProgressBySource.set(sourceId, progress);
}

export function getIngestStepProgress(
  sourceId: string,
): IngestStepProgress | null {
  return stepProgressBySource.get(sourceId) ?? null;
}

export function clearIngestStepProgress(sourceId: string) {
  stepProgressBySource.delete(sourceId);
}

type StepProgressStatus = "running" | "success";

function patchStepEntry(
  steps: WorkflowState["steps"] | undefined,
  stepId: string,
  status: StepProgressStatus,
  output?: unknown,
): WorkflowState["steps"] {
  const nextSteps = { ...(steps ?? {}) };
  const raw = nextSteps[stepId];
  const existing = Array.isArray(raw) ? raw[0] : raw;

  nextSteps[stepId] = {
    ...(existing ?? {}),
    status,
    ...(output !== undefined ? { output } : {}),
  };

  return nextSteps;
}

/** When a later step starts, clear earlier suspend gates so status polls aren't stuck. */
function clearEarlierSuspendedSteps(
  steps: WorkflowState["steps"] | undefined,
  activeStepId: string,
): WorkflowState["steps"] {
  const order = [
    CRAWL_REVIEW_STEP_ID,
    PARSE_REVIEW_STEP_ID,
    ENRICH_STEP_ID,
    EMBED_STEP_ID,
    STORE_STEP_ID,
  ];
  const activeIndex = order.indexOf(activeStepId);
  if (activeIndex < 0 || !steps) return steps ?? {};

  const nextSteps = { ...steps };
  for (let i = 0; i < activeIndex; i++) {
    const stepId = order[i]!;
    const raw = nextSteps[stepId];
    const existing = Array.isArray(raw) ? raw[0] : raw;
    if (!existing || existing.status !== "suspended") continue;
    nextSteps[stepId] = {
      ...existing,
      status: "success",
    };
  }
  return nextSteps;
}

export function markIngestStepProgress(
  sourceId: string,
  stepId: string,
  status: StepProgressStatus,
  output?: unknown,
) {
  const handle = getActiveIngestRunBySourceId(sourceId);
  if (!handle) return;

  let steps = patchStepEntry(handle.lastState.steps, stepId, status, output);
  if (status === "running") {
    steps = clearEarlierSuspendedSteps(steps, stepId);
  }

  handle.lastState = {
    ...handle.lastState,
    status: "running",
    steps,
  };
}

/** Expose workflow success to status polling before the resume HTTP call returns. */
export function markIngestWorkflowComplete(
  sourceId: string,
  result: unknown,
) {
  const handle = getActiveIngestRunBySourceId(sourceId);
  if (!handle) return;

  handle.lastState = {
    ...handle.lastState,
    status: "success",
    result: result as WorkflowState["result"],
  };
}

export type { WorkflowRunHandle };
