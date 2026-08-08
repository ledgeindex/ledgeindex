"use client";

import { useEffect, useMemo } from "react";
import Link from "next/link";
import { StreamingChatPanel } from "@/components/chat/streaming-chat-panel";
import { HeaderSelect } from "@/components/ui/header-select";
import { useSourceChatToolbar } from "@/contexts/source-chat-toolbar-context";
import { LEDGEINDEX_CHAT_MODELS } from "@/lib/chat-models";
import { modelSupportsThinking } from "@/lib/chat-thinking-level";
import type { ChatSuggestion } from "@/lib/chat-suggestions";
import {
  CLOUD_SOURCE_RERANK_BACKEND_ID,
  isCloudHostedSource,
  resolveSourceHosting,
} from "@/lib/rerank-backend";
import { pathOptionsFromStartUrls } from "@/lib/source-paths";
import { cn } from "@/lib/utils";

export const SOURCE_CHAT_SUGGESTIONS: ChatSuggestion[] = [
  {
    text: "tell me about durable agents",
    tag: "Single · Tier 1 full",
    tagVariant: "full",
  },
  {
    text: "What is Time travel in Mastra workflows?",
    tag: "Single · Tier 2 full",
    tagVariant: "tier2",
  },
  {
    text: "What can you tell me about workspaces?",
    tag: "Single · Tier 2 partial",
    tagVariant: "tier2",
  },
  {
    text: "are microphones supported?",
    tag: "Single · below threshold",
    tagVariant: "below",
  },
  {
    text: "How do I set up A2A agents and MCP servers in Mastra?",
    tag: "Multi · Tier 1 full",
    tagVariant: "full",
  },
  {
    text: "Was sind Workspaces und wie übergebe ich Daten zwischen Workflow-Schritten?",
    tag: "Multi · Tier 2 none",
    tagVariant: "multi",
  },
  {
    text: "Wie übergebe ich bei Workflows Daten zwischen Schritten?",
    tag: "Single · DE",
    tagVariant: "single",
  },
  {
    text: "What is the setup for createDurableAgent with Redis cache?",
    tag: "Single · niche doc",
    tagVariant: "single",
  },
  {
    text: "workspace overview and capabilities",
    tag: "Single · Catalog Q2 fallback",
    tagVariant: "catalog",
  },
  {
    text: "What capabilities are documented on the Mastra workspace overview page?",
    tag: "Single · Catalog Q2 fallback",
    tagVariant: "catalog",
  },
];

export function SourceChat({
  sourceId,
  sourceName,
  startUrls = [],
}: {
  sourceId: string;
  sourceName: string;
  startUrls?: readonly string[];
}) {
  const {
    modelId,
    setModelId,
    rerankBackend,
    activeSource,
    setTestPromptSuggestions,
    availableModels,
    needsProviderKeys,
    chatModelsReady,
    canChooseModel,
  } = useSourceChatToolbar();
  const pathOptions = useMemo(
    () => pathOptionsFromStartUrls(startUrls),
    [startUrls],
  );
  const sourceScope =
    activeSource?.scope === "global" ? "global" : "personal";
  const sourceHosting = resolveSourceHosting({
    hosting: activeSource?.hosting,
    scope: sourceScope,
  });
  const cloudSource = isCloudHostedSource({
    hosting: sourceHosting,
    scope: sourceScope,
  });
  const effectiveRerankBackend = cloudSource
    ? CLOUD_SOURCE_RERANK_BACKEND_ID
    : rerankBackend;

  useEffect(() => {
    setTestPromptSuggestions(SOURCE_CHAT_SUGGESTIONS);
    return () => setTestPromptSuggestions([]);
  }, [setTestPromptSuggestions]);

  const activeModel =
    availableModels.find((model) => model.id === modelId)?.label ??
    LEDGEINDEX_CHAT_MODELS.find((model) => model.id === modelId)?.label ??
    "selected model";

  const modelSelect =
    !canChooseModel ? null : needsProviderKeys ? (
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

  if (!chatModelsReady) {
    return (
      <p className="px-4 py-8 text-sm text-muted">Checking model keys…</p>
    );
  }

  if (needsProviderKeys) {
    return (
      <div className="mx-auto flex max-w-lg flex-1 flex-col items-start justify-center gap-3 px-4 py-16">
        <h2 className="text-lg font-semibold text-foreground">
          Add a model API key
        </h2>
        <p className="text-sm text-muted">
          Local chat needs at least one of OpenAI, Gemini, or DeepSeek. Add a
          key in Model keys, then come back here.
        </p>
        <Link
          href="/settings/providers"
          className="inline-flex h-9 items-center rounded-lg border border-border bg-card-solid px-3 text-sm font-medium text-foreground hover:bg-surface-raised"
        >
          Open Model keys
        </Link>
      </div>
    );
  }

  const welcomeMessage =
    pathOptions.length >= 2
      ? `Ask anything about **${sourceName}** with **${activeModel}**. Use **Paths** in the side panel for All or an individual docs root.`
      : `Ask anything about **${sourceName}** with **${activeModel}**. I'll search this indexed set and cite matching pages.`;

  return (
    <StreamingChatPanel
      key={`${sourceId}-${modelId}-${effectiveRerankBackend}-${sourceScope}-${sourceHosting}`}
      chatId={`source-chat-${sourceId}-${modelId}-${effectiveRerankBackend}`}
      agent="docsAgent"
      modelId={modelId}
      sourceId={sourceId}
      sourceName={sourceName}
      sourceScope={sourceScope}
      sourceHosting={sourceHosting}
      rerankBackend={effectiveRerankBackend}
      pathOptions={pathOptions}
      showDeepThinkingToggle={modelSupportsThinking(modelId)}
      welcomeMessage={welcomeMessage}
      inputPlaceholder="Ask about this documentation…"
      retrievalSidePanel
      toolbarEnd={modelSelect}
      className="min-h-0 flex-1 border-0 shadow-none"
    />
  );
}
