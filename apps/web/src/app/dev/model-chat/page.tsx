"use client";

import { useState } from "react";
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { StreamingChatPanel } from "@/components/chat/streaming-chat-panel";
import { ChatModelPicker } from "@/components/chat/chat-model-picker";
import {
  DEFAULT_CHAT_MODEL_ID,
  LEDGEINDEX_CHAT_MODELS,
  type LedgeIndexChatModelId,
} from "@/lib/chat-models";
import {
  CHAT_THINKING_LEVEL_OPTIONS,
  defaultThinkingLevelForModel,
  modelSupportsThinking,
  type ChatThinkingLevel,
} from "@/lib/chat-thinking-level";
import { cn } from "@/lib/utils";

export default function ModelChatDevPage() {
  const [modelId, setModelId] =
    useState<LedgeIndexChatModelId>(DEFAULT_CHAT_MODEL_ID);
  const [thinkingLevel, setThinkingLevel] = useState<ChatThinkingLevel>(() =>
    defaultThinkingLevelForModel(DEFAULT_CHAT_MODEL_ID),
  );

  const supportsThinking = modelSupportsThinking(modelId);
  const activeThinkingLevel = supportsThinking ? thinkingLevel : "off";

  const handleModelChange = (nextModelId: LedgeIndexChatModelId) => {
    setModelId(nextModelId);
    if (modelSupportsThinking(nextModelId)) {
      setThinkingLevel(defaultThinkingLevelForModel(nextModelId));
    }
  };

  return (
    <div className="flex min-h-dvh flex-col bg-surface-alt">
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 px-4 py-8">
        <div className="space-y-2">
          <p className="font-mono text-[0.5625rem] font-semibold tracking-[0.12em] text-muted uppercase">
            Dev · model test
          </p>
          <h1 className="text-xl font-semibold text-foreground">
            Standalone chat — compare models
          </h1>
          <p className="text-sm text-muted">
            Streams via Mastra{" "}
            <code className="rounded bg-surface-raised px-1 py-0.5 text-xs">
              /chat/modelTestAgent
            </code>
            . No RAG — latency, reasoning UI, and answer quality.
          </p>
          <Link
            href="/dashboard"
            className="inline-block text-sm text-accent hover:underline"
          >
            ← Back to dashboard
          </Link>
        </div>

        <ChatModelPicker
          modelId={modelId}
          onChange={handleModelChange}
          models={LEDGEINDEX_CHAT_MODELS}
        />

        {supportsThinking ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted">Dev thinking level:</span>
            {CHAT_THINKING_LEVEL_OPTIONS.filter((o) => o.value !== "off").map(
              (option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setThinkingLevel(option.value)}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                    thinkingLevel === option.value
                      ? "border-accent bg-accent/10 text-accent"
                      : "border-border bg-card-solid text-muted hover:text-foreground",
                  )}
                >
                  {option.label}
                </button>
              ),
            )}
          </div>
        ) : (
          <p className="text-xs text-muted">
            Deep thinking is only available on Gemini 3 models (not Gemma).
          </p>
        )}

        <StreamingChatPanel
          key={modelId}
          chatId={`model-test-${modelId}`}
          agent="modelTestAgent"
          modelId={modelId}
          thinkingLevel={activeThinkingLevel}
          showDeepThinkingToggle={false}
          welcomeMessage={`Testing **${LEDGEINDEX_CHAT_MODELS.find((m) => m.id === modelId)?.label}**. Ask anything — responses stream as tokens arrive.`}
          inputPlaceholder="Say hello, ask a reasoning question, or paste a paragraph to summarize…"
          className="min-h-[32rem] flex-1"
        />
      </main>
    </div>
  );
}
