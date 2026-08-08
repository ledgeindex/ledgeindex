"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type SourceBuilderVersionOption = {
  id: string;
  versionLabel: string;
  linkedSourceId?: string | null;
};

export type SourceBuilderHeaderState = {
  name: string;
  dirty: boolean;
  justSaved: boolean;
  draftId: string;
  versions: readonly SourceBuilderVersionOption[];
  aboutOpen: boolean;
  aboutBusy: boolean;
  onRename: (name: string) => void;
  onVersionChange: (versionId: string) => void;
  onSaveUpdate: () => void;
  onSaveAsNew: () => void;
  onIndex: () => void;
  onAboutToggle: () => void;
};

type SourceBuilderToolbarContextValue = {
  header: SourceBuilderHeaderState | null;
  setHeader: (header: SourceBuilderHeaderState | null) => void;
};

const SourceBuilderToolbarContext =
  createContext<SourceBuilderToolbarContextValue | null>(null);

export function SourceBuilderToolbarProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [header, setHeaderState] = useState<SourceBuilderHeaderState | null>(
    null,
  );

  const setHeader = useCallback((next: SourceBuilderHeaderState | null) => {
    setHeaderState(next);
  }, []);

  const value = useMemo(
    () => ({
      header,
      setHeader,
    }),
    [header, setHeader],
  );

  return (
    <SourceBuilderToolbarContext.Provider value={value}>
      {children}
    </SourceBuilderToolbarContext.Provider>
  );
}

export function useSourceBuilderToolbar() {
  const context = useContext(SourceBuilderToolbarContext);
  if (!context) {
    throw new Error(
      "useSourceBuilderToolbar must be used within SourceBuilderToolbarProvider",
    );
  }
  return context;
}

export function useOptionalSourceBuilderToolbar() {
  return useContext(SourceBuilderToolbarContext);
}
