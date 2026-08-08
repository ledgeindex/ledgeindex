"use client";

import { useEffect, useMemo, useState } from "react";
import {
  LEDGEINDEX_CHAT_MODELS,
  filterChatModelsByProviderKeys,
  pickDefaultChatModelId,
  type ChatProviderKeyStatus,
  type LedgeIndexChatModel,
  type LedgeIndexChatModelId,
} from "@/lib/chat-models";
import {
  useLedgeIndexDesktop,
  type DesktopProviderKeyStatus,
} from "@/lib/ledgeindex-desktop";

export type DesktopChatModelsState = {
  /** True once we know whether to filter (non-desktop or keys loaded). */
  ready: boolean;
  /** Desktop personal chat with no provider keys and no remote fallback. */
  needsKeys: boolean;
  /**
   * Chat should hit the hosted/remote API (Public catalog or Explore
   * cloud fallback) — not the local sidecar with desktop provider keys.
   */
  useRemoteApi: boolean;
  models: readonly LedgeIndexChatModel[];
  preferredModelId: LedgeIndexChatModelId;
};

function toChatKeys(
  status: DesktopProviderKeyStatus | null,
): ChatProviderKeyStatus | null {
  if (!status) return null;
  return {
    google: status.google,
    openai: status.openai,
    deepseek: status.deepseek,
  };
}

const FULL_CATALOG: DesktopChatModelsState = {
  ready: true,
  needsKeys: false,
  useRemoteApi: true,
  models: LEDGEINDEX_CHAT_MODELS,
  preferredModelId: pickDefaultChatModelId(LEDGEINDEX_CHAT_MODELS),
};

/**
 * Desktop personal (local) chat: only models with a configured provider key.
 * Web / Public remote / Explore cloud fallback: full catalog.
 */
export function useDesktopChatModels(options?: {
  /** When true, skip local key filtering (remote Public API). */
  useRemoteCatalog?: boolean;
  /**
   * Explore: if no desktop provider keys, use the hosted model catalog
   * instead of blocking on “Add a model API key”.
   */
  fallBackToRemoteWhenNoKeys?: boolean;
}): DesktopChatModelsState {
  const desktop = useLedgeIndexDesktop();
  const useRemoteCatalog = Boolean(options?.useRemoteCatalog);
  const fallBackToRemoteWhenNoKeys = Boolean(
    options?.fallBackToRemoteWhenNoKeys,
  );
  const [keys, setKeys] = useState<DesktopProviderKeyStatus | null>(null);
  const [keysReady, setKeysReady] = useState(false);

  useEffect(() => {
    if (!desktop?.getProviderKeyStatus || useRemoteCatalog) {
      setKeys(null);
      setKeysReady(true);
      return;
    }
    let cancelled = false;
    const load = () => {
      void desktop.getProviderKeyStatus?.().then((next) => {
        if (!cancelled) {
          setKeys(next);
          setKeysReady(true);
        }
      });
    };
    load();
    const id = window.setInterval(load, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [desktop, useRemoteCatalog]);

  return useMemo(() => {
    const shouldFilter = Boolean(desktop) && !useRemoteCatalog;
    if (!shouldFilter) {
      return {
        ...FULL_CATALOG,
        useRemoteApi: Boolean(desktop) ? useRemoteCatalog : false,
      };
    }
    if (!keysReady) {
      // Avoid flashing the key gate on Explore while keys load — use cloud.
      if (fallBackToRemoteWhenNoKeys) {
        return FULL_CATALOG;
      }
      return {
        ready: false,
        needsKeys: false,
        useRemoteApi: false,
        models: [],
        preferredModelId: pickDefaultChatModelId(LEDGEINDEX_CHAT_MODELS),
      };
    }
    const models = filterChatModelsByProviderKeys(toChatKeys(keys));
    if (models.length === 0 && fallBackToRemoteWhenNoKeys) {
      return FULL_CATALOG;
    }
    return {
      ready: true,
      needsKeys: models.length === 0,
      useRemoteApi: false,
      models,
      preferredModelId: pickDefaultChatModelId(models),
    };
  }, [
    desktop,
    useRemoteCatalog,
    fallBackToRemoteWhenNoKeys,
    keys,
    keysReady,
  ]);
}
