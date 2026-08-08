"use client";

import dynamic from "next/dynamic";

export const ThemeToggle = dynamic(
  () => import("@/components/theme-toggle").then((mod) => mod.ThemeToggle),
  {
    ssr: false,
    loading: () => (
      <span
        className="inline-flex size-9 shrink-0 rounded-full border border-border bg-card"
        aria-hidden
      />
    ),
  },
);
