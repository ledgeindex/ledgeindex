"use client";

import dynamic from "next/dynamic";

export const CitedChat3D = dynamic(
  () =>
    import("@/components/home/cited-chat-3d").then((mod) => mod.CitedChat3D),
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
