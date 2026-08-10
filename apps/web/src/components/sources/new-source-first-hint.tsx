"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { publicAssetUrl } from "@/lib/public-asset-url";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "ledgeindex:new-source-hint:v1";

export function hasDismissedNewSourceHint(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return true;
  }
}

export function dismissNewSourceHint(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, "1");
  } catch {
    // ignore
  }
}

/**
 * Subtle first-timer tip on the New source URL field.
 * Auto-hides once dismissed or once the user starts typing a URL.
 */
export function NewSourceFirstHint({
  hasUrl,
  className,
}: {
  hasUrl: boolean;
  className?: string;
}) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setVisible(!hasDismissedNewSourceHint());
  }, []);

  useEffect(() => {
    if (!hasUrl || !visible) return;
    dismissNewSourceHint();
    setVisible(false);
  }, [hasUrl, visible]);

  if (!visible || hasUrl) return null;

  return (
    <div
      role="note"
      className={cn(
        "relative rounded-lg border border-border/80 bg-surface-alt/80 px-3 py-2.5 pr-9 text-left shadow-sm",
        className,
      )}
    >
      <span
        aria-hidden
        className="absolute -top-1.5 left-6 size-3 rotate-45 border-t border-l border-border/80 bg-surface-alt/80"
      />
      <div className="flex items-start gap-2.5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={publicAssetUrl("/images/logo.webp?v=2")}
          alt=""
          width={28}
          height={28}
          className="mt-0.5 h-5 w-auto shrink-0"
          decoding="async"
        />
        <p className="min-w-0 text-[0.75rem] leading-5 text-muted-strong">
          Paste a docs URL to get started. Hit{" "}
          <span className="font-medium text-foreground">Check</span> to preview
          the site, then{" "}
          <span className="font-medium text-foreground">Crawl</span> when you’re
          ready to add it.
        </p>
      </div>
      <button
        type="button"
        onClick={() => {
          dismissNewSourceHint();
          setVisible(false);
        }}
        className="absolute top-1.5 right-1.5 rounded-md p-1 text-muted transition-colors hover:bg-surface-raised hover:text-foreground"
        aria-label="Dismiss tip"
      >
        <X className="size-3.5" aria-hidden />
      </button>
    </div>
  );
}
