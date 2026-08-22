"use client";

import { useWebCrawlHeaderControls } from "@/contexts/web-crawl-header-context";
import { cn } from "@/lib/utils";

export function AppHeaderWebCrawlControls() {
  const controls = useWebCrawlHeaderControls();
  if (!controls) return null;

  return (
    <>
      {/* Empty space inherits header drag so the window can still be moved. */}
      <div
        className="min-h-full min-w-[1.5rem] flex-1 self-stretch"
        aria-hidden
      />
      <div
        className={cn(
          "max-w-full shrink-0 overflow-x-auto",
          "[-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
          "[-webkit-app-region:no-drag]",
        )}
        onDoubleClick={(event) => event.stopPropagation()}
      >
        {controls}
      </div>
      <div
        className="min-h-full min-w-[1.5rem] flex-1 self-stretch"
        aria-hidden
      />
    </>
  );
}
