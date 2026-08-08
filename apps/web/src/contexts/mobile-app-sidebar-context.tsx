"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

type MobileAppSidebarContextValue = {
  isOpen: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
};

const MobileAppSidebarContext =
  createContext<MobileAppSidebarContextValue | null>(null);

export function MobileAppSidebarProvider({ children }: { children: ReactNode }) {
  const [isOpen, setOpen] = useState(false);

  const toggle = useCallback(() => {
    setOpen((current) => !current);
  }, []);

  const value = useMemo(
    () => ({ isOpen, setOpen, toggle }),
    [isOpen, toggle],
  );

  return (
    <MobileAppSidebarContext.Provider value={value}>
      {children}
    </MobileAppSidebarContext.Provider>
  );
}

export function useMobileAppSidebar() {
  return useContext(MobileAppSidebarContext);
}
