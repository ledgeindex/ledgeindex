import type { WorkflowResult, WorkflowState } from "@mastra/core/workflows";

/** Mastra fields the ingest pipeline UI and status API consume. */
export type IngestWorkflowRunSnapshot = {
  status: WorkflowState["status"];
  steps?: WorkflowState["steps"];
  result?: WorkflowState["result"];
  error?: WorkflowState["error"];
  payload?: WorkflowState["payload"];
  initialState?: WorkflowState["initialState"];
};

function isWorkflowStateShape(
  raw: WorkflowState | WorkflowResult<any, any, any, any>,
): raw is WorkflowState {
  return "initialState" in raw || "payload" in raw || "state" in raw;
}

export function ingestSnapshotFromMastraRun(
  raw: WorkflowState | WorkflowResult<any, any, any, any>,
): IngestWorkflowRunSnapshot {
  if (isWorkflowStateShape(raw)) {
    const withState = raw as WorkflowState & {
      state?: WorkflowState["initialState"];
    };
    return {
      status: raw.status,
      steps: raw.steps,
      result: raw.result,
      error: raw.error,
      payload: raw.payload,
      initialState: withState.initialState ?? withState.state,
    };
  }

  if (raw.status === "success") {
    return {
      status: raw.status,
      steps: raw.steps as WorkflowState["steps"],
      result: raw.result,
      payload: raw.input as WorkflowState["payload"],
      initialState: raw.state as WorkflowState["initialState"],
    };
  }

  if (raw.status === "failed") {
    return {
      status: raw.status,
      steps: raw.steps as WorkflowState["steps"],
      error: raw.error,
      payload: raw.input as WorkflowState["payload"],
      initialState: raw.state as WorkflowState["initialState"],
    };
  }

  return {
    status: raw.status,
    steps: raw.steps as WorkflowState["steps"],
    payload: raw.input as WorkflowState["payload"],
    initialState: raw.state as WorkflowState["initialState"],
  };
}

export function sourceIdFromIngestSnapshot(
  snapshot: IngestWorkflowRunSnapshot,
): string | undefined {
  const fromInitial = snapshot.initialState?.sourceId;
  if (typeof fromInitial === "string" && fromInitial.length > 0) {
    return fromInitial;
  }

  const fromPayload = snapshot.payload?.sourceId;
  if (typeof fromPayload === "string" && fromPayload.length > 0) {
    return fromPayload;
  }

  return undefined;
}
