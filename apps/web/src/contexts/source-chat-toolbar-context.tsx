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
  CLOUD_SOURCE_RERANK_BACKEND_ID,
  LOCAL_RERANK_BACKEND_ID,
  resolveAllowedRerankBackend,
  type LedgeIndexRerankBackendId,
} from "@/lib/rerank-backend";
import type { ChatSuggestionInput } from "@/lib/chat-suggestions";
import { useDesktopChatModels } from "@/lib/use-desktop-chat-models";
import { useAuth } from "@/lib/auth-context";

type ActiveSource = {
  sourceId: string;
  sourceName: string;
  startUrls?: string[];
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
  /** False for non-admins on cloud sets — the model is ours to pick, not theirs. */
  canChooseModel: boolean;
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

// Survive Vite HMR: mixed component/hook exports invalidate this module and
// recreate createContext() while an old Provider instance can stay mounted —
// consumers then see null and throw. One Context identity across reloads.
const sourceChatToolbarGlobal = globalThis as typeof globalThis & {
  __ledgeindexSourceChatToolbarContext?: ReturnType<
    typeof createContext<SourceChatToolbarContextValue | null>
  >;
};

const SourceChatToolbarContext =
  sourceChatToolbarGlobal.__ledgeindexSourceChatToolbarContext ??
  createContext<SourceChatToolbarContextValue | null>(null);

sourceChatToolbarGlobal.__ledgeindexSourceChatToolbarContext =
  SourceChatToolbarContext;

export function SourceChatToolbarProvider({ children }: { children: ReactNode }) {
  const { isAdmin } = useAuth();
  const [activeSource, setActiveSourceState] = useState<ActiveSource | null>(
    null,
  );
  const [exploreSession, setExploreSession] = useState(false);
  const [modelId, setModelId] =
    useState<LedgeIndexChatModelId>(DEFAULT_CHAT_MODEL_ID);
  const [rerankBackend, setRerankBackendState] =
    useState<LedgeIndexRerankBackendId>(LOCAL_RERANK_BACKEND_ID);
  const [testPromptSuggestions, setTestPromptSuggestions] = useState<
    readonly ChatSuggestionInput[]
  >([]);
  const [newChatAvailable, setNewChatAvailable] = useState(false);
  const testPromptSubmitRef = useRef<TestPromptSubmitHandler | null>(null);
  const newChatRef = useRef<NewChatHandler | null>(null);

  const isCloudSource =
    activeSource?.scope === "global" || activeSource?.hosting === "cloud";
  /** Cloud sets answer on our hosted models — only admins may switch those. */
  const canChooseModel = !isCloudSource || isAdmin;

  const chatModels = useDesktopChatModels({
    useRemoteCatalog: isCloudSource,
    fallBackToRemoteWhenNoKeys: exploreSession,
  });

  useEffect(() => {
    if (!chatModels.ready || chatModels.needsKeys) return;
    // Without a choice, pin the hosted default — a model picked on a local set
    // must not follow the user into a cloud set.
    if (canChooseModel && chatModels.models.some((model) => model.id === modelId)) {
      return;
    }
    setModelId(chatModels.preferredModelId);
  }, [chatModels, modelId, canChooseModel]);

  useEffect(() => {
    setRerankBackendState((current) =>
      resolveAllowedRerankBackend(current, isAdmin),
    );
  }, [isAdmin]);

  // Local indexes default to local MiniLM; cloud indexes force Cohere Auto.
  useEffect(() => {
    if (!activeSource) return;
    setRerankBackendState(
      isCloudSource
        ? CLOUD_SOURCE_RERANK_BACKEND_ID
        : LOCAL_RERANK_BACKEND_ID,
    );
  }, [activeSource?.sourceId, isCloudSource]);

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
      canChooseModel,
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
      canChooseModel,
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
