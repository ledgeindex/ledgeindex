"use client";

import dynamic from "next/dynamic";

export const KnowledgeCore3D = dynamic(
  () =>
    import("@/components/home/knowledge-core-3d").then(
      (mod) => mod.KnowledgeCore3D,
    ),
  {
    ssr: false,
    loading: () => (
      <div
        className="aspect-[4/3] w-full animate-pulse rounded-2xl bg-surface-alt/60"
        aria-hidden
      />
    ),
  },
);
