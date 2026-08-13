"use client";

import { useEffect } from "react";
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

/**
 * Playground chat: discover personal + global sources, then retrieve evidence.
 * Desktop without local model keys uses the hosted cloud API (no key gate).
 * With local keys, chat runs on the sidecar so personal indexes are included.
 */
export default function ExploreChatPage(): React.JSX.Element {
  const {
    modelId,
    setModelId,
    rerankBackend,
    availableModels,
    chatModelsReady,
    needsProviderKeys,
    chatUsesRemoteApi,
    setExploreSession,
  } = useSourceChatToolbar();
  const isDesktop = Boolean(getLedgeIndexDesktop());

  useEffect(() => {
    setExploreSession(true);
    return () => setExploreSession(false);
  }, [setExploreSession]);

  useEffect(() => {
    if (!isDesktop) return;
    setLedgeIndexApiBaseUrl(
      chatUsesRemoteApi
        ? (resolveDesktopRemoteApiUrl() ?? resolveDesktopLocalApiUrl())
        : resolveDesktopLocalApiUrl(),
    );
    return () => {
      const stored =
        typeof window !== "undefined"
          ? window.localStorage.getItem(DASHBOARD_SCOPE_STORAGE_KEY)
          : null;
      syncDesktopApiBaseForScope(stored === "global" ? "global" : "personal");
    };
  }, [isDesktop, chatUsesRemoteApi]);

  const modelSelect =
    needsProviderKeys ? (
      <Link
        href="/settings/providers"
        className={cn(
          "inline-flex h-8 items-center rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5",
          "text-xs font-medium text-amber-900 dark:text-amber-100",
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

  // Playground falls back to cloud when there are no local keys, so this gate
  // should only appear in edge cases (e.g. misconfigured remote catalog).
  if (needsProviderKeys) {
    return (
      <div className="mx-auto flex w-full max-w-lg flex-1 flex-col items-start justify-center gap-3 p-6">
        <div className="w-full rounded-xl border border-border bg-card-solid p-6 shadow-card">
          <h2 className="text-base font-semibold text-foreground">
            Add a model API key
          </h2>
          <p className="mt-2 text-sm text-muted">
            Cloud Playground should work without local keys. If you see this,
            add OpenAI, Gemini, or DeepSeek for local models, or check your
            connection.
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
        key={`${modelId}-${rerankBackend}-${chatUsesRemoteApi ? "cloud" : "local"}`}
        chatId={`explore-chat-${modelId}-${rerankBackend}`}
        agent="exploreAgent"
        modelId={modelId}
        rerankBackend={rerankBackend}
        showDeepThinkingToggle={modelSupportsThinking(modelId)}
        inputPlaceholder="Ask about your sources…"
        emptyHint={
          chatUsesRemoteApi
            ? "Using cloud models — ask about public or cloud sources. Add Model keys in Settings to include local personal indexes."
            : "Ask what sources are available (personal or global), or ask a question. Playground picks up to 3 sources and answers from the evidence."
        }
        toolbarEnd={modelSelect}
        // Full-bleed chat, so it sits on the app canvas like every other page
        // instead of painting the brighter card colour across the whole area.
        className="min-h-0 flex-1 rounded-none border-0 bg-surface-alt shadow-none"
      />
    </div>
  );
}
