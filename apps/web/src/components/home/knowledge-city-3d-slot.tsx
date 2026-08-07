"use client";

import dynamic from "next/dynamic";

export const KnowledgeCity3D = dynamic(
  () =>
    import("@/components/home/knowledge-city-3d").then(
      (mod) => mod.KnowledgeCity3D,
    ),
  {
    ssr: false,
    loading: () => (
      <div
        className="aspect-[917/675] w-full max-w-[min(100%,30rem)] animate-pulse rounded-2xl bg-surface-alt/60"
        aria-hidden
      />
    ),
  },
);
