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
  LOCAL_RERANK_BACKEND_ID,
  resolveSourceHosting,
} from "@/lib/rerank-backend";
import { pathOptionsFromStartUrls } from "@/lib/source-paths";
import { cn } from "@/lib/utils";

export const SOURCE_CHAT_SUGGESTIONS: ChatSuggestion[] = [
  {
    text: "what are the primitives",
    tag: "Golden · vague · reference",
    tagVariant: "tier2",
  },
  {
    text: "what is the Mastra class",
    tag: "Golden · reference",
    tagVariant: "tier2",
  },
  {
    text: "what are things you build with mastra",
    tag: "Golden · confusable-page",
    tagVariant: "catalog",
  },
  {
    text: "how do I create an agent",
    tag: "Golden · guide",
    tagVariant: "single",
  },
  {
    text: "how do workflows work in mastra",
    tag: "Golden · guide",
    tagVariant: "single",
  },
  {
    text: "how does memory work",
    tag: "Golden · guide",
    tagVariant: "single",
  },
  {
    text: "how do I add a tool to my agent",
    tag: "Golden · guide",
    tagVariant: "single",
  },
  {
    text: "how do I use MCP with mastra",
    tag: "Golden · guide",
    tagVariant: "single",
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
    activeSource,
    setTestPromptSuggestions,
    availableModels,
    needsProviderKeys,
    chatModelsReady,
    canChooseModel,
    retrievalStrictness,
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
    : LOCAL_RERANK_BACKEND_ID;

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
      key={`${sourceId}-${modelId}-${effectiveRerankBackend}-${sourceScope}-${sourceHosting}-${retrievalStrictness}`}
      chatId={`source-chat-${sourceId}-${modelId}-${effectiveRerankBackend}-${retrievalStrictness}`}
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
      hideRankingControl
      toolbarEnd={modelSelect}
      className="min-h-0 flex-1 border-0 shadow-none"
    />
  );
}
