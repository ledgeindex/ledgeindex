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
  syncDesktopApiBaseForScope,
} from "@/lib/desktop-api-routing";
import { getLedgeIndexDesktop } from "@/lib/ledgeindex-desktop";
import { modelSupportsThinking } from "@/lib/chat-thinking-level";
import { cn } from "@/lib/utils";

/**
 * Tool-using chat: discover personal + global sources, then retrieve evidence.
 * Desktop: chat runs on local sidecar; personal sources are local, globals may proxy remote.
 */
export default function ExploreChatPage(): React.JSX.Element {
  const {
    modelId,
    setModelId,
    rerankBackend,
    availableModels,
    chatModelsReady,
    needsProviderKeys,
  } = useSourceChatToolbar();
  const isDesktop = Boolean(getLedgeIndexDesktop());

  useEffect(() => {
    if (!isDesktop) return;
    // Explore agent + local LLM keys live on :3015 even when Public is selected.
    setLedgeIndexApiBaseUrl(resolveDesktopLocalApiUrl());
    return () => {
      const stored =
        typeof window !== "undefined"
          ? window.localStorage.getItem(DASHBOARD_SCOPE_STORAGE_KEY)
          : null;
      syncDesktopApiBaseForScope(stored === "global" ? "global" : "personal");
    };
  }, [isDesktop]);

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

  return (
    <div className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden">
      {needsProviderKeys ? (
        <div className="mx-auto flex w-full max-w-lg flex-1 flex-col items-start justify-center gap-3 p-6">
          <div className="w-full rounded-xl border border-border bg-card-solid p-6 shadow-card">
            <h2 className="text-base font-semibold text-foreground">
              Add a model API key
            </h2>
            <p className="mt-2 text-sm text-muted">
              Explore chat needs OpenAI, Gemini, or DeepSeek configured
              {isDesktop ? " for this desktop app" : ""}.
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
      ) : (
        <StreamingChatPanel
          key={`${modelId}-${rerankBackend}`}
          chatId={`explore-chat-${modelId}-${rerankBackend}`}
          agent="exploreAgent"
          modelId={modelId}
          rerankBackend={rerankBackend}
          showDeepThinkingToggle={modelSupportsThinking(modelId)}
          inputPlaceholder="Ask about your sources…"
          emptyHint="Ask what sources are available (personal or global), or ask a question — Explore will pick up to 3 sources and answer from the evidence."
          toolbarEnd={modelSelect}
          className="min-h-0 flex-1 rounded-none border-0 shadow-none"
        />
      )}
    </div>
  );
}
