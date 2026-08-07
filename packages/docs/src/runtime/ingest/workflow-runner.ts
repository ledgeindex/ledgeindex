import { randomUUID } from "node:crypto";
import { getMastra } from "../mastra/instance.js";
import {
  CRAWL_REVIEW_STEP_ID,
  PARSE_REVIEW_STEP_ID,
  ENRICH_STEP_ID,
  type IngestInput,
} from "../mastra/workflows/ingest-web-crawl/schemas.js";
import { logError, logInfo } from "../lib/logger.js";
import {
  getActiveIngestRun,
  listActiveIngestRunsForSource,
  registerActiveIngestRun,
  unregisterActiveIngestRun,
  type WorkflowRunHandle,
} from "./active-runs.js";
import {
  clearIngestCancellation,
  IngestCancelledError,
} from "./ingest-cancel.js";
import { buildPipelineSnapshot, type IngestPipelineSnapshot } from "./pipeline-status.js";
import {
  ingestSnapshotFromMastraRun,
  sourceIdFromIngestSnapshot,
  type IngestWorkflowRunSnapshot,
} from "./ingest-workflow-snapshot.js";

function getWorkflow() {
  return getMastra().getWorkflow("ingestWebCrawlWorkflow");
}

function isActiveWorkflowStatus(status: WorkflowRunHandle["lastState"]["status"]) {
  return (
    status === "running" ||
    status === "suspended" ||
    status === "waiting"
  );
}

async function rehydrateIngestRunHandle(
  runId: string,
): Promise<WorkflowRunHandle | null> {
  const existing = getActiveIngestRun(runId);
  if (existing) return existing;

  const workflow = getWorkflow();
  const state = await workflow.getWorkflowRunById(runId, {
    // Mastra field union is stricter than runtime; keep payload/state for rehydrate.
    fields: ["steps", "result", "error", "payload", "state"] as never,
  });
  if (!state) return null;

  const snapshot = ingestSnapshotFromMastraRun(state);
  const sourceId = sourceIdFromIngestSnapshot(snapshot);
  if (!sourceId) {
    logInfo("Ingest run found but missing sourceId", "IngestRunner", { runId });
    return null;
  }

  const run = await workflow.createRun({ runId });
  const handle: WorkflowRunHandle = {
    runId,
    sourceId,
    run,
    lastState: snapshot,
  };

  if (isActiveWorkflowStatus(snapshot.status)) {
    registerActiveIngestRun(handle);
    logInfo("Rehydrated active ingest workflow run", "IngestRunner", {
      runId,
      sourceId,
      status: snapshot.status,
    });
  }

  return handle;
}

function snapshotFromHandle(handle: WorkflowRunHandle): IngestPipelineSnapshot {
  return buildPipelineSnapshot({
    runId: handle.runId,
    state: handle.lastState,
    sourceId: handle.sourceId,
  });
}

/** Keep enrich on/off across Mastra resume/poll when setState isn't mirrored into run snapshots. */
function mergeEnrichPreferenceIntoRunSnapshot(
  snapshot: IngestWorkflowRunSnapshot,
  resumeData: Record<string, unknown>,
  previous: IngestWorkflowRunSnapshot | undefined,
): IngestWorkflowRunSnapshot {
  const fromResume =
    typeof resumeData.enrichExamples === "boolean"
      ? resumeData.enrichExamples
      : undefined;
  const prevState = previous?.initialState as
    | { enrichExamples?: boolean }
    | undefined;
  const nextState = snapshot.initialState as
    | { enrichExamples?: boolean }
    | undefined;
  const enrichExamples = fromResume ?? nextState?.enrichExamples ?? prevState?.enrichExamples;
  if (enrichExamples === undefined && fromResume === undefined) {
    return snapshot;
  }

  const enrichBackend =
    typeof resumeData.enrichBackend === "string"
      ? resumeData.enrichBackend
      : undefined;
  const enrichModelId =
    typeof resumeData.enrichModelId === "string"
      ? resumeData.enrichModelId
      : undefined;
  const enrichBaseUrl =
    typeof resumeData.enrichBaseUrl === "string"
      ? resumeData.enrichBaseUrl
      : undefined;
  const enrichGoogleModelId =
    typeof resumeData.enrichGoogleModelId === "string"
      ? resumeData.enrichGoogleModelId
      : undefined;
  const enrichContextTokenLimit =
    typeof resumeData.enrichContextTokenLimit === "number"
      ? resumeData.enrichContextTokenLimit
      : undefined;

  return {
    ...snapshot,
    initialState: {
      ...(typeof snapshot.initialState === "object" && snapshot.initialState
        ? snapshot.initialState
        : {}),
      ...(enrichExamples !== undefined ? { enrichExamples } : {}),
      ...(enrichBackend !== undefined ? { enrichBackend } : {}),
      ...(enrichModelId !== undefined ? { enrichModelId } : {}),
      ...(enrichBaseUrl !== undefined ? { enrichBaseUrl } : {}),
      ...(enrichGoogleModelId !== undefined ? { enrichGoogleModelId } : {}),
      ...(enrichContextTokenLimit !== undefined
        ? { enrichContextTokenLimit }
        : {}),
    },
  };
}

export async function startIngestWorkflow(
  input: IngestInput,
): Promise<IngestPipelineSnapshot> {
  const workflow = getWorkflow();
  const runId = randomUUID();
  const run = await workflow.createRun({ runId });

  logInfo("Starting ingest workflow", "IngestRunner", {
    runId,
    sourceId: input.sourceId,
  });

  clearIngestCancellation(input.sourceId);

  const started = await run.start({
    inputData: input,
    initialState: {
      sourceId: input.sourceId,
      projectId: input.projectId,
      config: input.config,
    },
  });

  const handle: WorkflowRunHandle = {
    runId,
    sourceId: input.sourceId,
    run,
    lastState: ingestSnapshotFromMastraRun(started),
  };
  registerActiveIngestRun(handle);

  return snapshotFromHandle(handle);
}

export async function resumeIngestWorkflow(input: {
  runId: string;
  step:
    | typeof CRAWL_REVIEW_STEP_ID
    | typeof PARSE_REVIEW_STEP_ID
    | typeof ENRICH_STEP_ID;
  resumeData: Record<string, unknown>;
}): Promise<IngestPipelineSnapshot> {
  const handle = await rehydrateIngestRunHandle(input.runId);
  if (!handle) {
    throw new Error(`Ingest run not found: ${input.runId}`);
  }

  if (!getActiveIngestRun(input.runId)) {
    registerActiveIngestRun(handle);
  }

  logInfo("Resuming ingest workflow", "IngestRunner", {
    runId: input.runId,
    step: input.step,
  });

  clearIngestCancellation(handle.sourceId);

  try {
    const previousState = handle.lastState;
    const resumed = await handle.run.resume({
      step: input.step,
      resumeData: input.resumeData,
    });

    handle.lastState = mergeEnrichPreferenceIntoRunSnapshot(
      ingestSnapshotFromMastraRun(resumed),
      input.resumeData,
      previousState,
    );

    if (resumed.status === "success" || resumed.status === "failed") {
      clearIngestCancellation(handle.sourceId);
      unregisterActiveIngestRun(input.runId);
    }

    return snapshotFromHandle(handle);
  } catch (error) {
    clearIngestCancellation(handle.sourceId);
    unregisterActiveIngestRun(input.runId);
    if (
      error instanceof IngestCancelledError ||
      (error instanceof Error && /indexing cancelled|ingest cancelled/i.test(error.message))
    ) {
      throw error instanceof IngestCancelledError
        ? error
        : new IngestCancelledError(handle.sourceId);
    }
    logError(error as Error, "IngestRunner", { runId: input.runId });
    throw error;
  }
}

export async function getIngestWorkflowStatus(
  runId: string,
): Promise<IngestPipelineSnapshot | null> {
  const handle = await rehydrateIngestRunHandle(runId);
  if (!handle) return null;
  return snapshotFromHandle(handle);
}

export { listActiveIngestRunsForSource };
