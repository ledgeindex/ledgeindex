"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DefaultChatTransport, type ToolUIPart } from "ai";
import { useChat } from "@ai-sdk/react";
import { publicAssetUrl } from "@/lib/public-asset-url";
import {
  Conversation,
  ConversationContent,
  ConversationFooter,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@/components/ai-elements/reasoning";
import {
  ChatToolResultCard,
  isToolPart,
} from "@/components/chat/chat-tool-result-card";
import {
  ChatRetrievalCard,
  parseRetrievalPart,
} from "@/components/chat/chat-retrieval-card";
import { MessageSources } from "@/components/chat/message-sources";
import { collectMessageCitationSources } from "@/lib/message-citation-sources";
import type { RetrievalMeta } from "@/lib/retrieval-meta";
import { authenticatedFetch } from "@/lib/ledgeindex-api";
import { getLedgeIndexDesktop } from "@/lib/ledgeindex-desktop";
import { resolveApiBaseForHosting } from "@/lib/desktop-api-routing";
import {
  mastraChatTransportBody,
  mastraChatUrl,
  type LocalAgentSelection,
  type LedgeIndexChatAgent,
} from "@/lib/mastra-chat";
import { DEFAULT_CHAT_MODEL_ID } from "@/lib/chat-models";
import {
  CLOUD_SOURCE_RERANK_BACKEND_ID,
  isCloudHostedSource,
  isCloudRerankBackend,
  LOCAL_RERANK_BACKEND_ID,
  resolveAllowedRerankBackend,
  resolveSourceHosting,
  type LedgeIndexRerankBackendId,
} from "@/lib/rerank-backend";
import {
  type ChatThinkingLevel,
  modelSupportsThinking,
  thinkingLevelFromDeepThinking,
} from "@/lib/chat-thinking-level";
import { DeepThinkingToggle } from "@/components/chat/deep-thinking-toggle";
import { CloudLocalToggle } from "@/components/chat/cloud-local-toggle";
import {
  PathScopePill,
  PathScopePills,
} from "@/components/chat/path-scope-pill";
import {
  PromptInput,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  type PromptInputMessage,
} from "@/components/ai-elements/prompt-input";
import { Cloud, MessageSquarePlus } from "lucide-react";
import { MessageStats } from "@/components/chat/message-stats";
import { cn } from "@/lib/utils";
import type { SourcePathOption } from "@/lib/source-paths";
import { useOptionalSourceChatToolbar } from "@/contexts/source-chat-toolbar-context";
import { useAuth } from "@/lib/auth-context";
import { SourceChatUpdateControls } from "@/components/sources/source-chat-update-controls";
import { AgentGuideReviewDialog } from "@/components/sources/agent-guide-review-dialog";

function reasoningText(parts: Array<{ type: string; text?: string }>): string {
  return parts
    .filter((part) => part.type === "reasoning" && part.text?.trim())
    .map((part) => part.text ?? "")
    .join("\n\n");
}

export function StreamingChatPanel({
  chatId,
  agent,
  modelId = DEFAULT_CHAT_MODEL_ID,
  sourceId,
  sourceName,
  welcomeMessage,
  welcomeTitle = "Ask this indexed set",
  emptyHint,
  inputPlaceholder = "Ask a question…",
  thinkingLevel,
  showDeepThinkingToggle = true,
  rerankBackend,
  /** When cloud-hosted, force Cohere-auto and show cloud icon (no rerank picker). */
  sourceScope,
  sourceHosting,
  exploreSourceSlugs = [],
  exploreSourceMode,
  localAgentSelection,
  sourceSelectionRequired = false,
  sourceSelectionControl,
  composerDisabled = false,
  hideRankingControl = false,
  showNewChatButton = false,
  pathOptions,
  retrievalSidePanel = false,
  toolbarEnd,
  className,
}: {
  chatId: string;
  agent: LedgeIndexChatAgent;
  modelId?: string;
  sourceId?: string;
  sourceName?: string;
  thinkingLevel?: ChatThinkingLevel;
  showDeepThinkingToggle?: boolean;
  rerankBackend?: LedgeIndexRerankBackendId;
  sourceScope?: "personal" | "global";
  sourceHosting?: "local" | "cloud";
  exploreSourceSlugs?: string[];
  exploreSourceMode?: "picker" | "all";
  localAgentSelection?: LocalAgentSelection;
  sourceSelectionRequired?: boolean;
  sourceSelectionControl?: React.ReactNode;
  composerDisabled?: boolean;
  hideRankingControl?: boolean;
  showNewChatButton?: boolean;
  pathOptions?: readonly SourcePathOption[];
  welcomeMessage?: string;
  welcomeTitle?: string;
  /** Centered empty-state hint when there is no welcome message (e.g. Explore). */
  emptyHint?: string;
  inputPlaceholder?: string;
  /** Show retrieval meta in a right column instead of inline in the thread. */
  retrievalSidePanel?: boolean;
  /** Extra controls beside New chat (e.g. model picker on Explore). */
  toolbarEnd?: React.ReactNode;
  className?: string;
}) {
  const toolbar = useOptionalSourceChatToolbar();
  const { isAdmin } = useAuth();
  const desktop = getLedgeIndexDesktop();
  const isDevEnv =
    process.env.NODE_ENV === "development" || Boolean(desktop?.isDev);
  /** Debug retrieval card/panel — admins and local/dev builds only. */
  const canSeeRetrievedSources = isAdmin || isDevEnv;
  const resolvedScope = sourceScope ?? toolbar?.activeSource?.scope;
  const resolvedHosting = resolveSourceHosting({
    hosting: sourceHosting ?? toolbar?.activeSource?.hosting,
    scope: resolvedScope,
  });
  const cloudSource = isCloudHostedSource({
    hosting: resolvedHosting,
    scope: resolvedScope,
  });
  const sourceSelectionReady =
    !sourceSelectionRequired || exploreSourceSlugs.length > 0;
  const composerReady = sourceSelectionReady && !composerDisabled;
  const chatApiBase = useMemo(() => {
    const scope = resolvedScope === "global" ? "global" : "personal";
    return resolveApiBaseForHosting({
      scope,
      hosting: resolvedHosting,
    });
  }, [resolvedScope, resolvedHosting]);
  const [localRerankBackend, setLocalRerankBackend] =
    useState<LedgeIndexRerankBackendId>(() =>
      resolveAllowedRerankBackend(rerankBackend, isAdmin)
    );
  const effectiveRerankBackend = cloudSource
    ? CLOUD_SOURCE_RERANK_BACKEND_ID
    : resolveAllowedRerankBackend(
        rerankBackend ?? toolbar?.rerankBackend ?? localRerankBackend,
        isAdmin
      );
  const retrievalPath: "cloud" | "local" = isCloudRerankBackend(
    effectiveRerankBackend
  )
    ? "cloud"
    : "local";
  /** Cloud path uses hosted models — no per-user model picker. */
  const showModelPicker =
    Boolean(toolbarEnd) && !cloudSource && retrievalPath === "local";
  const [input, setInput] = useState("");

  const [chatSession, setChatSession] = useState(0);
  const [pathScope, setPathScope] = useState("all");
  const [agentGuideOpen, setAgentGuideOpen] = useState(false);
  const [deepThinkingEnabled, setDeepThinkingEnabled] = useState(() =>
    modelSupportsThinking(modelId)
  );
  const modelIdRef = useRef(modelId);
  const sourceIdRef = useRef(sourceId);
  const sourceNameRef = useRef(sourceName);
  const thinkingLevelRef = useRef<ChatThinkingLevel>("off");
  const rerankBackendRef = useRef(rerankBackend);
  const retrievalStrictnessRef = useRef(
    toolbar?.retrievalStrictness ?? "strict"
  );
  const docsUrlPrefixRef = useRef<string | undefined>(undefined);
  const docsCrawlRootRef = useRef<string | undefined>(undefined);
  const sourceScopeRef = useRef(resolvedScope);
  const sourceHostingRef = useRef(resolvedHosting);
  const exploreSourceSlugsRef = useRef(exploreSourceSlugs);
  const exploreSourceModeRef = useRef(exploreSourceMode);
  const localAgentSelectionRef = useRef(localAgentSelection);
  const requestStartedAtRef = useRef<number | null>(null);
  const [clientDurations, setClientDurations] = useState<
    Record<string, number>
  >({});

  const resolvedPathOptions = pathOptions ?? [];
  const canEditAgentGuide = Boolean(
    sourceId &&
      retrievalSidePanel &&
      (resolvedScope !== "global" || isAdmin),
  );
  const activePath =
    pathScope === "all"
      ? null
      : (resolvedPathOptions.find((path) => path.id === pathScope) ?? null);

  useEffect(() => {
    if (pathScope === "all") return;
    if (!resolvedPathOptions.some((path) => path.id === pathScope)) {
      setPathScope("all");
    }
  }, [pathScope, resolvedPathOptions]);

  const resolvedThinkingLevel =
    thinkingLevel ??
    thinkingLevelFromDeepThinking(deepThinkingEnabled, modelId);

  const canUseDeepThinking = modelSupportsThinking(modelId);

  modelIdRef.current = modelId;
  sourceIdRef.current = sourceId;
  sourceNameRef.current = sourceName;
  thinkingLevelRef.current = resolvedThinkingLevel;
  rerankBackendRef.current = effectiveRerankBackend;
  retrievalStrictnessRef.current = toolbar?.retrievalStrictness ?? "strict";
  docsUrlPrefixRef.current = activePath?.startUrl;
  docsCrawlRootRef.current = activePath?.startUrl;
  sourceScopeRef.current = resolvedScope;
  sourceHostingRef.current = resolvedHosting;
  exploreSourceSlugsRef.current = exploreSourceSlugs;
  exploreSourceModeRef.current = exploreSourceMode;
  localAgentSelectionRef.current = localAgentSelection;

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: mastraChatUrl(agent, chatApiBase),
        fetch: authenticatedFetch,
        body: () =>
          mastraChatTransportBody({
            modelId: modelIdRef.current,
            sourceId: sourceIdRef.current,
            sourceName: sourceNameRef.current,
            sourceScope: sourceScopeRef.current,
            sourceHosting: sourceHostingRef.current,
            exploreSourceSlugs: exploreSourceSlugsRef.current,
            exploreSourceMode: exploreSourceModeRef.current,
            localAgentSelection: localAgentSelectionRef.current,
            thinkingLevel: thinkingLevelRef.current,
            rerankBackend: rerankBackendRef.current,
            retrievalStrictness: retrievalStrictnessRef.current,
            docsUrlPrefix: docsUrlPrefixRef.current,
            docsCrawlRoot: docsCrawlRootRef.current,
          }),
      }),
    [agent, chatApiBase]
  );

  const { messages, sendMessage, status, error } = useChat({
    transport,
    id: `${chatId}-${chatSession}`,
  });

  const prevStatusRef = useRef(status);
  useEffect(() => {
    const wasBusy =
      prevStatusRef.current === "submitted" ||
      prevStatusRef.current === "streaming";
    const isIdle = status === "ready" || status === "error";

    if (wasBusy && isIdle && requestStartedAtRef.current != null) {
      const durationMs = Date.now() - requestStartedAtRef.current;
      const lastAssistant = [...messages]
        .reverse()
        .find((message) => message.role === "assistant");
      if (lastAssistant) {
        setClientDurations((current) => ({
          ...current,
          [lastAssistant.id]: durationMs,
        }));
      }
      requestStartedAtRef.current = null;
    }

    prevStatusRef.current = status;
  }, [messages, status]);

  const busy = status === "submitted" || status === "streaming";
  const lastMessage = messages.at(-1);
  const lastHasVisibleAssistantOutput =
    lastMessage?.role === "assistant" &&
    lastMessage.parts.some(
      (part) =>
        (part.type === "text" && part.text?.trim()) ||
        part.type === "reasoning" ||
        isToolPart(part) ||
        Boolean(parseRetrievalPart(part))
    );
  // Show pending indicator until the first token / tool / retrieval UI appears.
  const showPendingIndicator =
    status === "submitted" ||
    (status === "streaming" && !lastHasVisibleAssistantOutput);
  const lastMessageId = messages.at(-1)?.id;

  const handleSubmit = useCallback(
    (message: PromptInputMessage) => {
      const trimmed = message.text.trim();
      if (!trimmed || busy || !sourceSelectionReady) return;
      setInput("");
      requestStartedAtRef.current = Date.now();
      void sendMessage({ text: trimmed });
    },
    [busy, sendMessage, sourceSelectionReady]
  );

  const handleSuggestionClick = useCallback(
    (suggestion: string) => {
      if (busy) return;
      setInput(suggestion);
    },
    [busy]
  );

  useEffect(() => {
    const register = toolbar?.registerTestPromptSubmit;
    if (!register) return;
    register(handleSuggestionClick);
    return () => register(null);
  }, [toolbar?.registerTestPromptSubmit, handleSuggestionClick]);

  const handleNewChat = useCallback(() => {
    if (busy) return;
    setInput("");
    setClientDurations({});
    requestStartedAtRef.current = null;
    setChatSession((session) => session + 1);
  }, [busy]);

  useEffect(() => {
    const register = toolbar?.registerNewChat;
    if (!register) return;
    register(handleNewChat);
    return () => register(null);
  }, [toolbar?.registerNewChat, handleNewChat]);

  useEffect(() => {
    // Header New chat stays visible for source chat; reset is a no-op when empty.
    toolbar?.setNewChatAvailable(true);
    return () => toolbar?.setNewChatAvailable(false);
  }, [toolbar]);

  const docsEmpty = messages.length === 0;
  const resolvedPlaceholder = inputPlaceholder;
  const resolvedWelcome = welcomeMessage;

  const showRetrievalPanel = retrievalSidePanel && canSeeRetrievedSources;
  const retrievalEntries = useMemo(() => {
    if (!showRetrievalPanel) return [];
    const entries: Array<{ key: string; meta: RetrievalMeta }> = [];
    for (const message of messages) {
      message.parts.forEach((part, index) => {
        const retrieval = parseRetrievalPart(part);
        if (retrieval) {
          entries.push({
            key: `${message.id}-retrieval-${index}`,
            meta: retrieval,
          });
        }
      });
    }
    return entries;
  }, [messages, showRetrievalPanel]);
  const retrievalNewestFirst = useMemo(
    () => [...retrievalEntries].reverse(),
    [retrievalEntries]
  );
  return (
    <div
      className={cn(
        "flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-card-solid shadow-card",
        className
      )}
    >
      <div
        className={cn(
          "flex min-h-0 flex-1",
          showRetrievalPanel ? "flex-col lg:flex-row" : "flex-col"
        )}
      >
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden">
          <Conversation>
            <ConversationContent
              className={cn(
                !showRetrievalPanel && "mx-auto max-w-3xl",
                "px-4 pt-5 pb-4 sm:px-6"
              )}
            >
              {docsEmpty ? (
                resolvedWelcome ? (
                  <div className="space-y-3">
                    {welcomeTitle ? (
                      <p className="font-mono text-[0.5625rem] font-semibold tracking-[0.12em] text-muted uppercase">
                        {welcomeTitle}
                      </p>
                    ) : null}
                    <Message from="assistant">
                      <MessageContent>
                        <MessageResponse>{resolvedWelcome}</MessageResponse>
                      </MessageContent>
                    </Message>
                  </div>
                ) : (
                  <div className="flex min-h-[min(28rem,55vh)] w-full flex-col items-center justify-center gap-4 px-4 py-10 text-center">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={publicAssetUrl("/images/logo.webp?v=2")}
                      alt=""
                      width={563}
                      height={808}
                      className="h-16 w-auto opacity-[0.18] dark:opacity-[0.22] sm:h-20"
                      decoding="async"
                      aria-hidden
                    />
                    {emptyHint ? (
                      <p className="max-w-sm text-sm text-muted">{emptyHint}</p>
                    ) : null}
                    {!sourceSelectionReady && sourceSelectionControl
                      ? sourceSelectionControl
                      : null}
                  </div>
                )
              ) : null}

              {messages.map((message, messageIndex) => {
                const reasoning = reasoningText(message.parts);
                const lastPart = message.parts.at(-1);
                const isReasoningStreaming =
                  status === "streaming" &&
                  message.id === lastMessageId &&
                  messageIndex === messages.length - 1 &&
                  lastPart?.type === "reasoning";
                const hasAssistantText =
                  message.role === "assistant" &&
                  message.parts.some(
                    (part) => part.type === "text" && part.text?.trim()
                  );
                const showFooter =
                  hasAssistantText &&
                  (messageIndex < messages.length - 1 ||
                    (status !== "streaming" && status !== "submitted"));
                const citationSources =
                  message.role === "assistant"
                    ? collectMessageCitationSources(message.parts)
                    : [];

                return (
                  <div key={message.id} className="w-full min-w-0 space-y-3">
                    {reasoning ? (
                      <Reasoning
                        className="w-full min-w-0"
                        isStreaming={isReasoningStreaming}
                      >
                        <ReasoningTrigger />
                        <ReasoningContent>{reasoning}</ReasoningContent>
                      </Reasoning>
                    ) : null}

                    {message.parts.map((part, index) => {
                      const retrieval = parseRetrievalPart(part);
                      if (retrieval) {
                        if (!canSeeRetrievedSources || showRetrievalPanel) {
                          return null;
                        }
                        return (
                          <ChatRetrievalCard
                            key={`${message.id}-retrieval-${index}`}
                            meta={retrieval}
                            retrievalStrictness={retrievalStrictnessRef.current}
                          />
                        );
                      }

                      if (!isToolPart(part)) return null;
                      return (
                        <ChatToolResultCard
                          key={`${message.id}-tool-${index}`}
                          part={part as ToolUIPart}
                        />
                      );
                    })}

                    {message.parts.map((part, index) => {
                      if (part.type === "reasoning" || isToolPart(part)) {
                        return null;
                      }
                      if (parseRetrievalPart(part)) return null;

                      if (part.type === "text" && part.text.trim()) {
                        return (
                          <Message
                            key={`${message.id}-text-${index}`}
                            from={message.role}
                          >
                            <MessageContent>
                              <MessageResponse
                                citationSources={citationSources}
                              >
                                {part.text}
                              </MessageResponse>
                            </MessageContent>
                          </Message>
                        );
                      }

                      return null;
                    })}

                    {showFooter ? (
                      <>
                        <MessageStats
                          parts={message.parts}
                          metadata={message.metadata}
                          clientDurationMs={clientDurations[message.id]}
                        />
                        <MessageSources
                          parts={message.parts}
                          role={message.role}
                        />
                      </>
                    ) : null}
                  </div>
                );
              })}

              {showPendingIndicator ? (
                <div
                  className="flex items-center px-1 py-2"
                  aria-live="polite"
                  aria-label="Waiting for response"
                >
                  <span
                    className="size-2 animate-pulse rounded-full bg-muted-foreground/70 motion-reduce:animate-none"
                    aria-hidden
                  />
                </div>
              ) : null}

              {error ? (
                <p className="text-xs text-red-600 dark:text-red-300">
                  {error.message}
                </p>
              ) : null}
            </ConversationContent>
            <ConversationScrollButton />
          </Conversation>

          <ConversationFooter className="border-t-0 bg-transparent px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-1 sm:px-4">
            <div
              className={cn(
                "w-full",
                !showRetrievalPanel && "mx-auto max-w-3xl"
              )}
            >
              <PromptInput className="gap-0 p-0" onSubmit={handleSubmit}>
                <PromptInputTextarea
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  placeholder={resolvedPlaceholder}
                  disabled={!composerReady}
                  className="min-h-10 max-h-28 w-full px-3 py-2.5"
                />
                <PromptInputFooter className="border-t border-border/60 px-2 py-1.5">
                  <PromptInputTools className="gap-1">
                    {!showRetrievalPanel ? (
                      <PathScopePill
                        pathOptions={resolvedPathOptions}
                        pathScope={pathScope}
                        onPathScopeChange={setPathScope}
                        disabled={busy}
                      />
                    ) : null}
                    {showDeepThinkingToggle &&
                    thinkingLevel === undefined &&
                    canUseDeepThinking ? (
                      <DeepThinkingToggle
                        enabled={deepThinkingEnabled}
                        onChange={setDeepThinkingEnabled}
                        disabled={busy}
                        title={
                          deepThinkingEnabled
                            ? "Deep thinking on — slower, may show reasoning"
                            : "Enable deep thinking for slower, more thorough answers"
                        }
                      />
                    ) : null}
                    {sourceSelectionControl ?? null}
                    {hideRankingControl ? null : cloudSource ? (
                      <span
                        title="Cloud-hosted index — always ranked with Cohere"
                        aria-label="Ranking: Cohere cloud"
                        className={cn(
                          "inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-card-solid px-2",
                          "text-muted"
                        )}
                      >
                        <span
                          aria-hidden
                          className="hidden font-mono text-[0.5625rem] tracking-[0.1em] uppercase sm:inline"
                        >
                          Ranking
                        </span>
                        <Cloud className="size-3.5" aria-hidden />
                        <span className="hidden text-xs font-medium sm:inline">
                          Cloud
                        </span>
                      </span>
                    ) : (
                      <CloudLocalToggle
                        value={retrievalPath}
                        disabled={busy}
                        label="Ranking"
                        ariaLabel="Ranking model — does not move your index"
                        localTitle="Rank on this machine with MiniLM. Nothing leaves your device. Slower."
                        cloudTitle="Rank with Cohere. Your index stays local; matching page text is sent to Cohere to be scored. Much faster."
                        onChange={(next) => {
                          const backend =
                            next === "cloud"
                              ? CLOUD_SOURCE_RERANK_BACKEND_ID
                              : LOCAL_RERANK_BACKEND_ID;
                          setLocalRerankBackend(backend);
                          toolbar?.setRerankBackend(backend);
                        }}
                      />
                    )}
                    {showModelPicker ? toolbarEnd : null}
                  </PromptInputTools>
                  {showNewChatButton ? (
                    <button
                      type="button"
                      onClick={handleNewChat}
                      disabled={busy || messages.length === 0}
                      title="Clear this conversation and start a new chat"
                      aria-label="Start a new chat"
                      className={cn(
                        "inline-flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-card-solid text-muted transition-colors",
                        "hover:bg-surface-raised hover:text-foreground disabled:cursor-not-allowed disabled:opacity-45"
                      )}
                    >
                      <MessageSquarePlus className="size-3.5" aria-hidden />
                    </button>
                  ) : null}
                  <PromptInputSubmit
                    status={status}
                    disabled={!input.trim() || busy || !composerReady}
                    className="size-8"
                  />
                </PromptInputFooter>
              </PromptInput>
            </div>
          </ConversationFooter>
        </div>

        {showRetrievalPanel ? (
          <aside
            className={cn(
              "flex min-h-0 w-full shrink-0 flex-col border-border bg-surface-raised/40",
              retrievalEntries.length === 0
                ? "hidden lg:flex"
                : "max-h-[42vh] lg:max-h-none",
              "border-t lg:w-[22rem] lg:border-t-0 lg:border-l xl:w-[26rem]"
            )}
            aria-label="Retrieved sources"
          >
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2.5">
              <p className="font-mono text-[0.5625rem] font-semibold tracking-[0.12em] text-muted uppercase">
                Retrieved sources
              </p>
              <div className="flex shrink-0 items-center gap-1.5">
                {canEditAgentGuide ? (
                  <button
                    type="button"
                    onClick={() => setAgentGuideOpen(true)}
                    className="inline-flex shrink-0 items-center rounded-md border border-border bg-card-solid px-2 py-1 font-mono text-[0.5rem] font-semibold tracking-[0.08em] text-muted uppercase transition-colors hover:border-foreground/15 hover:text-foreground"
                  >
                    Agent guide
                  </button>
                ) : null}
                {sourceId ? <SourceChatUpdateControls variant="panel" /> : null}
              </div>
            </div>
            {resolvedPathOptions.length >= 2 ? (
              <div className="shrink-0 border-b border-border px-3 py-2.5">
                <PathScopePills
                  pathOptions={resolvedPathOptions}
                  pathScope={pathScope}
                  onPathScopeChange={setPathScope}
                  disabled={busy}
                />
              </div>
            ) : null}
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
              {retrievalNewestFirst.length === 0 ? (
                <div className="flex h-full min-h-[10rem] items-center justify-center">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={publicAssetUrl("/images/logo.webp?v=2")}
                    alt=""
                    width={563}
                    height={808}
                    className="h-16 w-auto opacity-[0.18] dark:opacity-[0.22] sm:h-20"
                    decoding="async"
                    aria-hidden
                  />
                </div>
              ) : (
                retrievalNewestFirst.map((entry) => (
                  <ChatRetrievalCard
                    key={entry.key}
                    meta={entry.meta}
                    retrievalStrictness={retrievalStrictnessRef.current}
                  />
                ))
              )}
            </div>
          </aside>
        ) : null}
      </div>
      {canEditAgentGuide && sourceId ? (
        <AgentGuideReviewDialog
          open={agentGuideOpen}
          sourceId={sourceId}
          mode="edit"
          onComplete={() => setAgentGuideOpen(false)}
        />
      ) : null}
    </div>
  );
}
