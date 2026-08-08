"use client";

import dynamic from "next/dynamic";

export const KnowledgePipeline3D = dynamic(
  () =>
    import("@/components/home/knowledge-pipeline-3d").then(
      (mod) => mod.KnowledgePipeline3D,
    ),
  {
    ssr: false,
    loading: () => (
      <div
        className="aspect-[4/3] w-full max-w-[min(100%,18rem)] animate-pulse rounded-2xl bg-surface-alt/60 sm:max-w-[16rem]"
        aria-hidden
      />
    ),
  },
);
