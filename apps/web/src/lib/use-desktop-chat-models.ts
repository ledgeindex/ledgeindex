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
  /** Desktop personal chat with no provider keys configured. */
  needsKeys: boolean;
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

/**
 * Desktop personal (local) chat: only models with a configured provider key.
 * Web / Public remote: full catalog.
 */
export function useDesktopChatModels(options?: {
  /** When true, skip local key filtering (remote Public API). */
  useRemoteCatalog?: boolean;
}): DesktopChatModelsState {
  const desktop = useLedgeIndexDesktop();
  const useRemoteCatalog = Boolean(options?.useRemoteCatalog);
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
        ready: true,
        needsKeys: false,
        models: LEDGEINDEX_CHAT_MODELS,
        preferredModelId: pickDefaultChatModelId(LEDGEINDEX_CHAT_MODELS),
      };
    }
    if (!keysReady) {
      return {
        ready: false,
        needsKeys: false,
        models: [],
        preferredModelId: pickDefaultChatModelId(LEDGEINDEX_CHAT_MODELS),
      };
    }
    const models = filterChatModelsByProviderKeys(toChatKeys(keys));
    return {
      ready: true,
      needsKeys: models.length === 0,
      models,
      preferredModelId: pickDefaultChatModelId(models),
    };
  }, [desktop, useRemoteCatalog, keys, keysReady]);
}
