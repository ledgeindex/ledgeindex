import {
  authenticatedFetch,
  getLedgeIndexApiBaseUrl,
} from "@/lib/ledgeindex-api";
import type { LocalAgentSelection } from "@/lib/mastra-chat";

export type PreparedLocalAgentWorkspace = {
  status: "ready";
  workspaceKey: string;
  sourceCount: number;
  pageCount: number;
  fileCount: number;
  byteCount: number;
  cacheHit: boolean;
};

type UnavailableLocalAgentWorkspace = {
  status: "unavailable";
  reason: string;
  message: string;
};

export async function prepareLocalAgentWorkspace(
  selection: LocalAgentSelection,
  signal?: AbortSignal,
): Promise<PreparedLocalAgentWorkspace> {
  const base = getLedgeIndexApiBaseUrl().replace(/\/$/, "");
  const response = await authenticatedFetch(
    `${base}/api/playground/local-agent-workspace/prepare`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ selection }),
      signal,
    },
  );

  const body = (await response.json()) as
    | PreparedLocalAgentWorkspace
    | UnavailableLocalAgentWorkspace;
  if (!response.ok || body.status !== "ready") {
    throw new Error(
      body.status === "unavailable"
        ? body.message
        : `Workspace preparation failed (${response.status}).`,
    );
  }
  return body;
}
