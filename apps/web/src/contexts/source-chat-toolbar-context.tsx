"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  DEFAULT_CHAT_MODEL_ID,
  type LedgeIndexChatModel,
  type LedgeIndexChatModelId,
} from "@/lib/chat-models";
import {
  DEFAULT_RERANK_BACKEND_ID,
  resolveAllowedRerankBackend,
  type LedgeIndexRerankBackendId,
} from "@/lib/rerank-backend";
import type { ChatSuggestionInput } from "@/lib/chat-suggestions";
import { useDesktopChatModels } from "@/lib/use-desktop-chat-models";
import { useAuth } from "@/lib/auth-context";

type ActiveSource = {
  sourceId: string;
  sourceName: string;
  scope?: "personal" | "global";
  hosting?: "local" | "cloud";
};

type TestPromptSubmitHandler = (prompt: string) => void;
type NewChatHandler = () => void;

type SourceChatToolbarContextValue = {
  activeSource: ActiveSource | null;
  /** Explore tab — may fall back to hosted models when no local keys. */
  exploreSession: boolean;
  modelId: LedgeIndexChatModelId;
  rerankBackend: LedgeIndexRerankBackendId;
  testPromptSuggestions: readonly ChatSuggestionInput[];
  availableModels: readonly LedgeIndexChatModel[];
  chatModelsReady: boolean;
  needsProviderKeys: boolean;
  /** Desktop Explore/Public: point chat at the hosted API. */
  chatUsesRemoteApi: boolean;
  newChatAvailable: boolean;
  setActiveSource: (source: ActiveSource | null) => void;
  setExploreSession: (active: boolean) => void;
  setModelId: (modelId: LedgeIndexChatModelId) => void;
  setRerankBackend: (backendId: LedgeIndexRerankBackendId) => void;
  setTestPromptSuggestions: (
    suggestions: readonly ChatSuggestionInput[],
  ) => void;
  registerTestPromptSubmit: (handler: TestPromptSubmitHandler | null) => void;
  submitTestPrompt: (prompt: string) => void;
  registerNewChat: (handler: NewChatHandler | null) => void;
  setNewChatAvailable: (available: boolean) => void;
  requestNewChat: () => void;
};

const SourceChatToolbarContext =
  createContext<SourceChatToolbarContextValue | null>(null);

export function SourceChatToolbarProvider({ children }: { children: ReactNode }) {
  const { isAdmin } = useAuth();
  const [activeSource, setActiveSourceState] = useState<ActiveSource | null>(
    null,
  );
  const [exploreSession, setExploreSession] = useState(false);
  const [modelId, setModelId] =
    useState<LedgeIndexChatModelId>(DEFAULT_CHAT_MODEL_ID);
  const [rerankBackend, setRerankBackendState] =
    useState<LedgeIndexRerankBackendId>(DEFAULT_RERANK_BACKEND_ID);
  const [testPromptSuggestions, setTestPromptSuggestions] = useState<
    readonly ChatSuggestionInput[]
  >([]);
  const [newChatAvailable, setNewChatAvailable] = useState(false);
  const testPromptSubmitRef = useRef<TestPromptSubmitHandler | null>(null);
  const newChatRef = useRef<NewChatHandler | null>(null);

  const chatModels = useDesktopChatModels({
    useRemoteCatalog:
      activeSource?.scope === "global" || activeSource?.hosting === "cloud",
    fallBackToRemoteWhenNoKeys: exploreSession,
  });

  useEffect(() => {
    if (!chatModels.ready || chatModels.needsKeys) return;
    if (!chatModels.models.some((model) => model.id === modelId)) {
      setModelId(chatModels.preferredModelId);
    }
  }, [chatModels, modelId]);

  useEffect(() => {
    setRerankBackendState((current) =>
      resolveAllowedRerankBackend(current, isAdmin),
    );
  }, [isAdmin]);

  const setRerankBackend = useCallback(
    (backendId: LedgeIndexRerankBackendId) => {
      setRerankBackendState(resolveAllowedRerankBackend(backendId, isAdmin));
    },
    [isAdmin],
  );

  const setActiveSource = useCallback((source: ActiveSource | null) => {
    setActiveSourceState(source);
  }, []);

  const registerTestPromptSubmit = useCallback(
    (handler: TestPromptSubmitHandler | null) => {
      testPromptSubmitRef.current = handler;
    },
    [],
  );

  const submitTestPrompt = useCallback((prompt: string) => {
    testPromptSubmitRef.current?.(prompt);
  }, []);

  const registerNewChat = useCallback((handler: NewChatHandler | null) => {
    newChatRef.current = handler;
  }, []);

  const requestNewChat = useCallback(() => {
    newChatRef.current?.();
  }, []);

  const value = useMemo(
    () => ({
      activeSource,
      exploreSession,
      modelId,
      rerankBackend,
      testPromptSuggestions,
      availableModels: chatModels.models,
      chatModelsReady: chatModels.ready,
      needsProviderKeys: chatModels.needsKeys,
      chatUsesRemoteApi: chatModels.useRemoteApi,
      newChatAvailable,
      setActiveSource,
      setExploreSession,
      setModelId,
      setRerankBackend,
      setTestPromptSuggestions,
      registerTestPromptSubmit,
      submitTestPrompt,
      registerNewChat,
      setNewChatAvailable,
      requestNewChat,
    }),
    [
      activeSource,
      exploreSession,
      modelId,
      rerankBackend,
      testPromptSuggestions,
      chatModels.models,
      chatModels.ready,
      chatModels.needsKeys,
      chatModels.useRemoteApi,
      newChatAvailable,
      setActiveSource,
      setRerankBackend,
      registerTestPromptSubmit,
      submitTestPrompt,
      registerNewChat,
      requestNewChat,
    ],
  );

  return (
    <SourceChatToolbarContext.Provider value={value}>
      {children}
    </SourceChatToolbarContext.Provider>
  );
}

export function useSourceChatToolbar() {
  const context = useContext(SourceChatToolbarContext);
  if (!context) {
    throw new Error(
      "useSourceChatToolbar must be used within SourceChatToolbarProvider",
    );
  }
  return context;
}

export function useOptionalSourceChatToolbar() {
  return useContext(SourceChatToolbarContext);
}
