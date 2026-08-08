"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { formatUrlLabel } from "@/components/sources/source-display";
import {
  getSource,
  isPdfUrl,
  normalizeStartUrl,
  updateSource,
  UNSUPPORTED_PDF_START_URL_MESSAGE,
  type SourceSummary,
} from "@/lib/ledgeindex-api";

function resolveAddedStartUrl(
  raw: string,
  existingStartUrls: string[],
): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("Enter a URL or path");
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return normalizeStartUrl(trimmed);
  }

  const base = existingStartUrls[0];
  if (!base) {
    throw new Error("This set has no start URL to resolve a path against");
  }

  const origin = new URL(base).origin;
  const path = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return normalizeStartUrl(`${origin}${path}`);
}

function sameSite(a: string, b: string): boolean {
  try {
    const hostA = new URL(a).hostname.replace(/^www\./i, "").toLowerCase();
    const hostB = new URL(b).hostname.replace(/^www\./i, "").toLowerCase();
    return hostA === hostB;
  } catch {
    return false;
  }
}

export function SourceAddStartUrlDialog({
  source,
  open,
  onOpenChange,
  onSaved,
}: {
  source: SourceSummary;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: (startUrls: string[]) => void;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const existingUrls = useMemo(() => {
    const fromList = (source.startUrls ?? []).filter(Boolean);
    if (fromList.length > 0) return [...new Set(fromList)];
    return source.startUrl ? [source.startUrl] : [];
  }, [source.startUrl, source.startUrls]);

  useEffect(() => {
    if (!open) return;
    setDraft("");
    setError(null);
    const timer = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [open]);

  if (!open) return null;

  async function handleContinue() {
    setError(null);
    let nextUrl: string;
    try {
      nextUrl = resolveAddedStartUrl(draft, existingUrls);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid URL");
      return;
    }

    if (isPdfUrl(nextUrl)) {
      setError(UNSUPPORTED_PDF_START_URL_MESSAGE);
      return;
    }

    const normalizedExisting = existingUrls.map((url) =>
      normalizeStartUrl(url).replace(/\/$/, ""),
    );
    if (normalizedExisting.includes(nextUrl.replace(/\/$/, ""))) {
      setError("That start URL is already on this set");
      return;
    }

    if (existingUrls[0] && !sameSite(existingUrls[0], nextUrl)) {
      setError("Use a URL on the same site as the existing start URLs");
      return;
    }

    setSaving(true);
    try {
      const { source: full } = await getSource(source.id);
      const merged = [
        ...new Set([
          ...(full.config.startUrls ?? existingUrls),
          nextUrl,
        ].map((url) => normalizeStartUrl(url))),
      ];

      await updateSource(source.id, {
        config: {
          ...full.config,
          startUrls: merged,
        },
      });
      onSaved?.(merged);
      onOpenChange(false);

      const scope =
        (source.scope ?? "personal") === "global" ? "&scope=global" : "";
      router.push(
        `/sources/web-crawl?url=${encodeURIComponent(nextUrl)}${scope}&mode=add-path&sourceId=${encodeURIComponent(source.id)}`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add start URL");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-start-url-title"
        className="w-full max-w-md rounded-xl border border-border bg-card-solid p-5 shadow-card"
      >
        <h2
          id="add-start-url-title"
          className="text-base font-semibold text-foreground"
        >
          Add start URL
        </h2>
        <p className="mt-2 text-sm text-muted">
          Add another crawl root to{" "}
          <span className="font-medium text-foreground">{source.name}</span>{" "}
          without re-crawling existing paths. Next you’ll crawl only the new
          URL.
        </p>

        {existingUrls.length > 0 ? (
          <div className="mt-3 rounded-lg border border-border bg-surface-raised/60 px-3 py-2">
            <p className="font-mono text-[0.5rem] font-semibold tracking-[0.1em] text-muted uppercase">
              Current start URLs
            </p>
            <ul className="mt-1 space-y-0.5">
              {existingUrls.map((url) => (
                <li
                  key={url}
                  className="truncate font-mono text-[0.6875rem] text-muted-strong"
                  title={url}
                >
                  {formatUrlLabel(url)}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <label className="mt-4 block">
          <span className="mb-1 block font-mono text-[0.625rem] font-semibold tracking-[0.12em] text-muted uppercase">
            New start URL or path
          </span>
          <input
            ref={inputRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void handleContinue();
              }
            }}
            placeholder="/components or https://…"
            spellCheck={false}
            className="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-sm text-foreground"
          />
        </label>
        <p className="mt-1.5 text-xs text-muted">
          Path-only values resolve against this set’s site (e.g.{" "}
          <span className="font-mono">/components</span>).
        </p>

        {error ? (
          <p className="mt-3 text-sm text-red-600 dark:text-red-300">{error}</p>
        ) : null}

        <div className="mt-5 flex justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            disabled={saving}
            onClick={() => onOpenChange(false)}
            className="h-9 px-4 text-xs"
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={saving || !draft.trim()}
            onClick={() => void handleContinue()}
            className="h-9 px-4 text-xs"
          >
            {saving ? "Saving…" : "Continue to crawl"}
          </Button>
        </div>
      </div>
    </div>
  );
}
