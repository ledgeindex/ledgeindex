"use client";

import { useRouter, useSearchParams } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

type IndexedFlashContextValue = {
  flashId: string | null;
  showNotice: boolean;
  /** Show the header “Index saved” notice without a URL round-trip. */
  triggerIndexedFlash: (sourceId?: string) => void;
};

const IndexedFlashContext = createContext<IndexedFlashContextValue>({
  flashId: null,
  showNotice: false,
  triggerIndexedFlash: () => {},
});

export function IndexedFlashProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const indexedParam = searchParams.get("indexed");
  const [flashId, setFlashId] = useState<string | null>(null);
  const [showNotice, setShowNotice] = useState(false);

  const clearNotice = useCallback(() => {
    setFlashId(null);
    setShowNotice(false);
  }, []);

  const triggerIndexedFlash = useCallback(
    (sourceId?: string) => {
      setFlashId(sourceId?.trim() || "local");
      setShowNotice(true);
      window.setTimeout(() => {
        clearNotice();
      }, 4500);
    },
    [clearNotice],
  );

  useEffect(() => {
    if (!indexedParam) return;

    setFlashId(indexedParam);
    setShowNotice(true);

    const timer = window.setTimeout(() => {
      clearNotice();

      const params = new URLSearchParams(window.location.search);
      if (!params.has("indexed")) return;
      params.delete("indexed");
      const query = params.toString();
      router.replace(
        query ? `${window.location.pathname}?${query}` : window.location.pathname,
        { scroll: false },
      );
    }, 4500);

    return () => window.clearTimeout(timer);
  }, [indexedParam, router, clearNotice]);

  const value = useMemo(
    () => ({ flashId, showNotice, triggerIndexedFlash }),
    [flashId, showNotice, triggerIndexedFlash],
  );

  return (
    <IndexedFlashContext.Provider value={value}>
      {children}
    </IndexedFlashContext.Provider>
  );
}

export function useIndexedFlash() {
  return useContext(IndexedFlashContext);
}
