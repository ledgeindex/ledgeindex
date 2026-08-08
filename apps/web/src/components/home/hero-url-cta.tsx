"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { normalizeStartUrl } from "@/lib/ledgeindex-api";

type HeroUrlCtaProps = {
  className?: string;
};

export function HeroUrlCta({ className }: HeroUrlCtaProps) {
  const router = useRouter();
  const [url, setUrl] = useState("");

  return (
    <form
      className={cn("w-full", className)}
      onSubmit={(event) => {
        event.preventDefault();
        const normalized = normalizeStartUrl(url || "docs.example.com");
        router.push(
          `/sources/web-crawl?url=${encodeURIComponent(normalized)}`,
        );
      }}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch sm:gap-0">
        <label htmlFor="hero-docs-url" className="sr-only">
          Documentation URL
        </label>
        <input
          id="hero-docs-url"
          type="text"
          inputMode="url"
          autoComplete="url"
          placeholder="docs.yourcompany.com"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          className={cn(
            "h-12 w-full min-w-0 rounded-md border border-border/90 bg-card-solid px-5",
            "text-sm text-foreground shadow-[0_1px_2px_rgb(15_23_42/0.04)] placeholder:text-muted/80",
            "outline-none transition-colors focus:border-foreground/20 sm:rounded-r-none sm:border-r-0",
            "dark:shadow-[0_1px_0_rgb(255_248_246/0.03)_inset,0_1px_2px_rgb(0_0_0/0.25)]",
          )}
        />
        <button
          type="submit"
          className={cn(
            "inline-flex h-12 shrink-0 items-center justify-center rounded-md px-6",
            "text-sm font-medium transition-all",
            "bg-foreground text-background hover:opacity-90",
            "sm:rounded-l-none",
          )}
        >
          Try with my docs
        </button>
      </div>
    </form>
  );
}
