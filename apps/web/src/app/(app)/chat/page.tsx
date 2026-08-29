"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { setLedgeIndexApiBaseUrl } from "@ledgeindex/client";
import { StreamingChatPanel } from "@/components/chat/streaming-chat-panel";
import { HeaderSelect } from "@/components/ui/header-select";
import { useSourceChatToolbar } from "@/contexts/source-chat-toolbar-context";
import { DASHBOARD_SCOPE_STORAGE_KEY } from "@/contexts/dashboard-toolbar-context";
import {
  resolveDesktopLocalApiUrl,
  resolveDesktopRemoteApiUrl,
  syncDesktopApiBaseForScope,
} from "@/lib/desktop-api-routing";
import { getLedgeIndexDesktop } from "@/lib/ledgeindex-desktop";
import { modelSupportsThinking } from "@/lib/chat-thinking-level";
import { cn } from "@/lib/utils";
import {
  PlaygroundSourcePicker,
  type PlaygroundTarget,
} from "@/components/sources/playground-source-picker";
import {
  PlaygroundModeToggle,
  type PlaygroundMode,
} from "@/components/chat/playground-mode-toggle";
import {
  prepareLocalAgentWorkspace,
  type PreparedLocalAgentWorkspace,
} from "@/lib/local-agent-workspace";
import type { LocalAgentSelection } from "@/lib/mastra-chat";

const PLAYGROUND_TARGET_STORAGE_KEY = "ledgeindex:playground-target";
const PLAYGROUND_MODE_STORAGE_KEY = "ledgeindex:playground-mode";

function parseStoredTarget(raw: string | null): PlaygroundTarget | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    const sourceSlugs = Array.isArray(value.sourceSlugs)
      ? value.sourceSlugs.filter(
          (slug): slug is string => typeof slug === "string" && slug.length > 0
        )
      : [];
    if (
      typeof value.name !== "string" ||
      sourceSlugs.length === 0 ||
      (value.scope !== "personal" && value.scope !== "global") ||
      (value.hosting !== "local" && value.hosting !== "cloud")
    ) {
      return null;
    }

    if (
      value.kind === "source-set" &&
      typeof value.id === "string" &&
      value.scope === "personal"
    ) {
      const agentEligible =
        value.agentEligible === true ||
        (value.agentEligible === undefined && value.hosting === "local");
      return {
        kind: "source-set",
        id: value.id,
        name: value.name,
        sourceSlugs: [sourceSlugs[0]!, ...sourceSlugs.slice(1)],
        scope: "personal",
        hosting: value.hosting,
        agentEligible,
      };
    }

    const storedIds = Array.isArray(value.ids)
      ? value.ids.filter(
          (id): id is string => typeof id === "string" && id.length > 0
        )
      : typeof value.id === "string"
        ? [value.id]
        : [];
    if (
      (value.kind === "sources" || value.kind === "source") &&
      storedIds.length > 0 &&
      storedIds.length <= 3 &&
      sourceSlugs.length === storedIds.length
    ) {
      const agentEligible =
        value.agentEligible === true ||
        (value.agentEligible === undefined &&
          value.scope === "personal" &&
          value.hosting === "local");
      return {
        kind: "sources",
        ids: [storedIds[0]!, ...storedIds.slice(1)],
        name: value.name,
        sourceSlugs: [sourceSlugs[0]!, ...sourceSlugs.slice(1)],
        scope: value.scope,
        hosting: value.hosting,
        agentEligible,
      };
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Playground chat: discover personal + global sources, then retrieve evidence.
 * Desktop without local model keys uses the hosted cloud API (no key gate).
 * With local keys, chat runs on the sidecar so personal indexes are included.
 */
export default function ExploreChatPage(): React.JSX.Element {
  const [target, setTarget] = useState<PlaygroundTarget | null>(null);
  const [mode, setMode] = useState<PlaygroundMode>("retrieval");
  const [preparedWorkspace, setPreparedWorkspace] =
    useState<PreparedLocalAgentWorkspace | null>(null);
  const [workspacePreparing, setWorkspacePreparing] = useState(false);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const targetId =
    target?.kind === "source-set"
      ? target.id
      : (target?.ids.join(",") ?? "none");
  const {
    modelId,
    setModelId,
    rerankBackend,
    availableModels,
    chatModelsReady,
    needsProviderKeys,
    setActiveSource,
    setExploreSession,
  } = useSourceChatToolbar();
  const isDesktop = Boolean(getLedgeIndexDesktop());

  useEffect(() => {
    const stored = parseStoredTarget(
      window.localStorage.getItem(PLAYGROUND_TARGET_STORAGE_KEY)
    );
    if (stored) {
      setTarget(stored);
      if (
        stored.agentEligible &&
        window.localStorage.getItem(PLAYGROUND_MODE_STORAGE_KEY) === "agent"
      ) {
        setMode("agent");
      }
    }
  }, []);

  function handleTargetChange(nextTarget: PlaygroundTarget | null) {
    setTarget(nextTarget);
    setPreparedWorkspace(null);
    setWorkspaceError(null);
    if (!nextTarget?.agentEligible && mode === "agent") {
      setMode("retrieval");
      window.localStorage.setItem(
        PLAYGROUND_MODE_STORAGE_KEY,
        "retrieval"
      );
    }
    if (!nextTarget) {
      window.localStorage.removeItem(PLAYGROUND_TARGET_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(
      PLAYGROUND_TARGET_STORAGE_KEY,
      JSON.stringify(nextTarget)
    );
  }

  function handleModeChange(nextMode: PlaygroundMode) {
    if (nextMode === "agent" && !target?.agentEligible) return;
    setMode(nextMode);
    setWorkspaceError(null);
    window.localStorage.setItem(PLAYGROUND_MODE_STORAGE_KEY, nextMode);
  }

  const localAgentSelection: LocalAgentSelection | undefined = target
    ? target.kind === "source-set"
      ? { kind: "source-set", sourceSetId: target.id }
      : { kind: "sources", sourceIds: target.ids }
    : undefined;

  useEffect(() => {
    if (
      mode !== "agent" ||
      !target?.agentEligible ||
      !localAgentSelection
    ) {
      setWorkspacePreparing(false);
      return;
    }

    const controller = new AbortController();
    setWorkspacePreparing(true);
    setWorkspaceError(null);
    setPreparedWorkspace(null);

    void prepareLocalAgentWorkspace(localAgentSelection, controller.signal)
      .then((prepared) => {
        if (!controller.signal.aborted) setPreparedWorkspace(prepared);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setWorkspaceError(
          error instanceof Error
            ? error.message
            : "Failed to prepare the local source workspace."
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setWorkspacePreparing(false);
      });

    return () => controller.abort();
  }, [
    mode,
    target?.agentEligible,
    targetId,
    target?.kind,
  ]);

  useEffect(() => {
    setExploreSession(true);
    return () => setExploreSession(false);
  }, [setExploreSession]);

  useEffect(() => {
    setActiveSource(
      target
        ? {
            sourceId: targetId,
            sourceName: target.name,
            scope: target.scope,
            hosting: target.hosting,
          }
        : null
    );
    return () => setActiveSource(null);
  }, [setActiveSource, target, targetId]);

  useEffect(() => {
    if (!isDesktop) return;
    setLedgeIndexApiBaseUrl(
      target?.hosting === "cloud"
        ? (resolveDesktopRemoteApiUrl() ?? resolveDesktopLocalApiUrl())
        : resolveDesktopLocalApiUrl()
    );
    return () => {
      const stored =
        typeof window !== "undefined"
          ? window.localStorage.getItem(DASHBOARD_SCOPE_STORAGE_KEY)
          : null;
      syncDesktopApiBaseForScope(stored === "global" ? "global" : "personal");
    };
  }, [isDesktop, target?.hosting]);

  const modelSelect = needsProviderKeys ? (
    <Link
      href="/settings/providers"
      className={cn(
        "inline-flex h-8 items-center rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5",
        "text-xs font-medium text-amber-900 dark:text-amber-100"
      )}
    >
      Add API key
    </Link>
  ) : chatModelsReady && availableModels.length > 0 ? (
    <HeaderSelect
      ariaLabel="Chat model"
      value={modelId}
      onChange={setModelId}
      options={availableModels.map((model) => ({
        value: model.id,
        label: model.label,
      }))}
    />
  ) : null;

  // Playground uses the hosted API when no local keys exist, but model choices
  // still follow configured provider keys (add keys in Settings to pick a model).
  if (needsProviderKeys) {
    return (
      <div className="mx-auto flex w-full max-w-lg flex-1 flex-col items-start justify-center gap-3 p-6">
        <div className="w-full rounded-xl border border-border bg-card-solid p-6 shadow-card">
          <h2 className="text-base font-semibold text-foreground">
            Add a model API key
          </h2>
          <p className="mt-2 text-sm text-muted">
            Add at least one provider key below to choose a chat model. Keys
            stay on this machine and power the local API on port 3015.
          </p>
          {isDesktop ? (
            <Link
              href="/settings/providers"
              className="mt-4 inline-flex h-9 items-center rounded-lg border border-border bg-background px-3 text-sm font-medium text-foreground hover:bg-surface-raised"
            >
              Open Model keys
            </Link>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden">
      <StreamingChatPanel
        key={`${mode}-${modelId}-${target?.kind ?? "none"}-${targetId}-${preparedWorkspace?.workspaceKey ?? "cold"}`}
        chatId={`${mode}-chat-${modelId}-${targetId}`}
        agent={mode === "agent" ? "localSourceAgent" : "exploreAgent"}
        modelId={modelId}
        rerankBackend={rerankBackend}
        sourceScope={target?.scope}
        sourceHosting={target?.hosting}
        exploreSourceSlugs={target?.sourceSlugs}
        exploreSourceMode={target?.kind === "sources" ? "all" : "picker"}
        localAgentSelection={
          mode === "agent" ? localAgentSelection : undefined
        }
        sourceSelectionRequired
        composerDisabled={
          mode === "agent" &&
          (workspacePreparing ||
            !preparedWorkspace ||
            Boolean(workspaceError))
        }
        sourceSelectionControl={
          <div className="flex min-w-0 items-center gap-1">
            <PlaygroundModeToggle
              value={mode}
              onChange={handleModeChange}
              agentEnabled={Boolean(target?.agentEligible)}
            />
            <PlaygroundSourcePicker
              value={target}
              onChange={handleTargetChange}
              disabled={workspacePreparing}
            />
            {workspaceError ? (
              <span
                className="max-w-48 truncate text-xs text-destructive"
                title={workspaceError}
              >
                {workspaceError}
              </span>
            ) : null}
          </div>
        }
        hideRankingControl
        showNewChatButton={!isDesktop}
        showDeepThinkingToggle={modelSupportsThinking(modelId)}
        inputPlaceholder={
          workspacePreparing
            ? "Preparing local source files…"
            : workspaceError
              ? "Agent workspace is unavailable"
              : target
                ? `Ask about ${target.name}…`
                : "Select a source to start…"
        }
        emptyHint={
          workspacePreparing
            ? "Reconstructing the selected index and building its local search cache."
            : workspaceError
              ? workspaceError
              : target
                ? mode === "agent"
                  ? `The agent can search and inspect files reconstructed from ${target.name}.`
                  : `Ask a question grounded in ${target.name}.`
                : "Select an existing source or source set before asking a question."
        }
        toolbarEnd={isDesktop ? null : modelSelect}
        // Full-bleed chat, so it sits on the app canvas like every other page
        // instead of painting the brighter card colour across the whole area.
        className="min-h-0 flex-1 rounded-none border-0 bg-surface-alt shadow-none"
      />
    </div>
  );
}
