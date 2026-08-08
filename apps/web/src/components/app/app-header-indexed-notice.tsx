"use client";

import { useIndexedFlash } from "@/contexts/indexed-flash-context";

export function AppHeaderIndexedNotice() {
  const { showNotice } = useIndexedFlash();

  if (!showNotice) return null;

  return (
    <p
      className="min-w-0 flex-1 truncate rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-300 sm:px-3 sm:text-sm"
      role="status"
      aria-live="polite"
    >
      Index saved · ready to query
    </p>
  );
}
