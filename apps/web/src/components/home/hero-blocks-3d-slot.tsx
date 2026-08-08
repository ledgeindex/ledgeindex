"use client";

import dynamic from "next/dynamic";

export const HeroBlocks3D = dynamic(
  () =>
    import("@/components/home/hero-blocks-3d").then((mod) => mod.HeroBlocks3D),
  {
    ssr: false,
    loading: () => (
      <div
        className="aspect-[545/635] w-full max-w-[min(100%,17rem)] animate-pulse rounded-2xl bg-surface-alt/60 sm:max-w-[22rem] lg:max-w-[26rem]"
        aria-hidden
      />
    ),
  },
);
