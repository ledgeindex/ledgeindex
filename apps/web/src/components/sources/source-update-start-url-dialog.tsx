"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { formatUrlLabel } from "@/components/sources/source-display";
import { normalizeStartUrl, type SourceSummary } from "@/lib/ledgeindex-api";
import { cn } from "@/lib/utils";

function formatStartPathLabel(url: string): string {
  try {
    const path = new URL(url).pathname.replace(/\/+$/, "") || "/";
    return path;
  } catch {
    return formatUrlLabel(url);
  }
}

export function SourceUpdateStartUrlDialog({
  source,
  open,
  onOpenChange,
}: {
  source: SourceSummary;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const existingUrls = useMemo(() => {
    const fromList = (source.startUrls ?? []).filter(Boolean);
    if (fromList.length > 0)
      return [...new Set(fromList.map(normalizeStartUrl))];
    return source.startUrl ? [normalizeStartUrl(source.startUrl)] : [];
  }, [source.startUrl, source.startUrls]);

  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open) return;
    setSelected(new Set());
  }, [open, existingUrls]);

  if (!open) return null;

  const selectedList = existingUrls.filter((url) => selected.has(url));
  const allSelected =
    existingUrls.length > 0 && selectedList.length === existingUrls.length;

  function toggle(url: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
  }

  function toggleAll() {
    if (allSelected) {
      setSelected(new Set());
      return;
    }
    setSelected(new Set(existingUrls));
  }

  function handleContinue() {
    if (selectedList.length === 0) return;
    const scope =
      (source.scope ?? "personal") === "global" ? "&scope=global" : "";
    onOpenChange(false);
    const primary = selectedList[0]!;
    const urlsParam = encodeURIComponent(JSON.stringify(selectedList));
    router.push(
      `/sources/web-crawl?url=${encodeURIComponent(primary)}&urls=${urlsParam}${scope}&mode=update-path&sourceId=${encodeURIComponent(source.id)}`,
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="update-start-url-title"
        className="w-full max-w-md rounded-xl border border-border bg-card-solid p-5 shadow-card"
      >
        <h2
          id="update-start-url-title"
          className="text-base font-semibold text-foreground"
        >
          Update start URLs
        </h2>
        <p className="mt-2 text-sm text-muted">
          Pick one or more crawl roots on{" "}
          <span className="font-medium text-foreground">{source.name}</span>.
          Only the selected roots are crawled — others stay as they are.
        </p>

        {existingUrls.length === 0 ? (
          <p className="mt-4 text-sm text-muted">
            This set has no start URLs yet.
          </p>
        ) : (
          <>
            <div className="mt-4 flex items-center justify-between gap-2">
              <p className="font-mono text-[0.5rem] font-semibold tracking-[0.1em] text-muted uppercase">
                {selectedList.length} selected
              </p>
              <button
                type="button"
                onClick={toggleAll}
                className="rounded-md border border-border bg-surface-raised px-2 py-0.5 font-mono text-[0.5rem] font-semibold tracking-[0.08em] text-muted uppercase transition-colors hover:text-foreground"
              >
                {allSelected ? "Clear" : "Select all"}
              </button>
            </div>
            <ul className="mt-2 max-h-56 space-y-1.5 overflow-y-auto">
              {existingUrls.map((url) => {
                const checked = selected.has(url);
                return (
                  <li key={url}>
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={checked}
                      aria-label={`${checked ? "Deselect" : "Select"} ${url}`}
                      onClick={() => toggle(url)}
                      className={cn(
                        "flex w-full cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors",
                        checked
                          ? "border-accent/30 bg-accent-soft"
                          : "border-border hover:bg-surface-raised",
                      )}
                    >
                      <span
                        aria-hidden
                        className={cn(
                          "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-[4px] border-2 transition-colors",
                          checked
                            ? "border-accent bg-accent text-background"
                            : "border-muted-strong bg-card-solid text-transparent",
                        )}
                      >
                        {checked ? (
                          <svg
                            viewBox="0 0 10 8"
                            className="size-2.5 fill-none stroke-current stroke-[2.5]"
                          >
                            <path d="M1 4l2.5 2.5L9 1" />
                          </svg>
                        ) : null}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block font-mono text-[0.6875rem] font-semibold text-foreground">
                          {formatStartPathLabel(url)}
                        </span>
                        <span className="mt-0.5 block truncate font-mono text-[0.625rem] text-muted">
                          {formatUrlLabel(url)}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() => onOpenChange(false)}
            className="h-9 px-4 text-xs"
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={selectedList.length === 0}
            onClick={handleContinue}
            className="h-9 px-4 text-xs"
          >
            Continue to crawl
            {selectedList.length > 0 ? ` (${selectedList.length})` : ""}
          </Button>
        </div>
      </div>
    </div>
  );
}
