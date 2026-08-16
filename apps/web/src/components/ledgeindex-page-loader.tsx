"use client";

import { useEffect, useState } from "react";
import { publicAssetUrl } from "@/lib/public-asset-url";
import { cn } from "@/lib/utils";

export function LedgeIndexPageLoader({
  label = "Loading",
  className,
}: {
  label?: string;
  className?: string;
}) {
  const [dots, setDots] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => {
      setDots((current) => (current + 1) % 4);
    }, 420);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-5",
        className,
      )}
      role="status"
      aria-live="polite"
      aria-label={label}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={publicAssetUrl("/images/logo.webp?v=2")}
        alt=""
        width={563}
        height={808}
        className="h-16 w-auto shrink-0 opacity-90 sm:h-20"
        decoding="async"
      />
      <p className="font-mono text-sm tracking-[0.12em] text-muted uppercase">
        {label}
        <span className="inline-block w-[1.5em] text-left" aria-hidden>
          {".".repeat(dots)}
        </span>
      </p>
    </div>
  );
}
