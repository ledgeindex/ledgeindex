"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
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

function resolveAddedStartUrls(
  rawEntries: readonly string[],
  existingStartUrls: string[],
): string[] {
  const entries = rawEntries
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (entries.length === 0) throw new Error("Enter at least one URL or path");

  const base = existingStartUrls[0];
  return [
    ...new Set(
      entries.map((entry) => {
        if (/^https?:\/\//i.test(entry)) return normalizeStartUrl(entry);
        if (!base) {
          throw new Error(
            "This set has no start URL to resolve a path against",
          );
        }
        const origin = new URL(base).origin;
        const path = entry.startsWith("/") ? entry : `/${entry}`;
        return normalizeStartUrl(`${origin}${path}`);
      }),
    ),
  ];
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
  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const [drafts, setDrafts] = useState<string[]>([""]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const existingUrls = useMemo(() => {
    const fromList = (source.startUrls ?? []).filter(Boolean);
    if (fromList.length > 0) return [...new Set(fromList)];
    return source.startUrl ? [source.startUrl] : [];
  }, [source.startUrl, source.startUrls]);

  useEffect(() => {
    if (!open) return;
    setDrafts([""]);
    setError(null);
    const timer = window.setTimeout(() => inputRefs.current[0]?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [open]);

  if (!open) return null;

  function addDraftField() {
    setDrafts((current) => {
      const nextIndex = current.length;
      window.setTimeout(() => inputRefs.current[nextIndex]?.focus(), 0);
      return [...current, ""];
    });
  }

  async function handleContinue() {
    setError(null);
    let resolvedUrls: string[];
    try {
      resolvedUrls = resolveAddedStartUrls(drafts, existingUrls);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid URL");
      return;
    }

    if (resolvedUrls.some(isPdfUrl)) {
      setError(UNSUPPORTED_PDF_START_URL_MESSAGE);
      return;
    }

    const normalizedExisting = existingUrls.map((url) =>
      normalizeStartUrl(url).replace(/\/$/, ""),
    );
    const nextUrls = resolvedUrls.filter(
      (url) => !normalizedExisting.includes(url.replace(/\/$/, "")),
    );
    if (nextUrls.length === 0) {
      setError("Those start URLs are already on this set");
      return;
    }

    if (
      existingUrls[0] &&
      nextUrls.some((url) => !sameSite(existingUrls[0], url))
    ) {
      setError("Use URLs on the same site as the existing start URLs");
      return;
    }

    setSaving(true);
    try {
      const { source: full } = await getSource(source.id);
      const merged = [
        ...new Set([
          ...(full.config.startUrls ?? existingUrls),
          ...nextUrls,
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
        `/sources/web-crawl?url=${encodeURIComponent(nextUrls[0])}&urls=${encodeURIComponent(JSON.stringify(nextUrls))}${scope}&mode=add-path&sourceId=${encodeURIComponent(source.id)}`,
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
          Add start URLs
        </h2>
        <p className="mt-2 text-sm text-muted">
          Add another crawl root to{" "}
          <span className="font-medium text-foreground">{source.name}</span>{" "}
          without re-crawling existing paths. Next you’ll crawl only the new
          URLs.
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

        <div className="mt-4">
          <div className="mb-1.5 flex items-center justify-between gap-3">
            <p className="font-mono text-[0.625rem] font-semibold tracking-[0.12em] text-muted uppercase">
              New start URLs or paths
            </p>
            <button
              type="button"
              onClick={addDraftField}
              className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-card-solid px-2 text-[0.6875rem] font-medium text-muted transition-colors hover:text-foreground"
            >
              <Plus className="size-3" aria-hidden />
              Add path
            </button>
          </div>
          <div className="space-y-2">
            {drafts.map((draft, index) => (
              <div key={index} className="flex items-center gap-2">
                <input
                  ref={(element) => {
                    inputRefs.current[index] = element;
                  }}
                  value={draft}
                  onChange={(event) =>
                    setDrafts((current) =>
                      current.map((entry, entryIndex) =>
                        entryIndex === index ? event.target.value : entry,
                      ),
                    )
                  }
                  onKeyDown={(event) => {
                    if (event.key !== "Enter") return;
                    event.preventDefault();
                    if (index === drafts.length - 1) {
                      addDraftField();
                    } else {
                      inputRefs.current[index + 1]?.focus();
                    }
                  }}
                  placeholder={
                    index === 0
                      ? "/components or https://…"
                      : "/guides or https://…"
                  }
                  spellCheck={false}
                  className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-2 font-mono text-sm text-foreground"
                />
                <button
                  type="button"
                  aria-label={`Remove start URL ${index + 1}`}
                  onClick={() =>
                    setDrafts((current) =>
                      current.length === 1
                        ? [""]
                        : current.filter(
                            (_, entryIndex) => entryIndex !== index,
                          ),
                    )
                  }
                  className="inline-flex size-9 shrink-0 items-center justify-center rounded-md border border-border text-muted transition-colors hover:bg-surface-raised hover:text-red-600"
                >
                  <Trash2 className="size-3.5" aria-hidden />
                </button>
              </div>
            ))}
          </div>
        </div>
        <p className="mt-1.5 text-xs text-muted">
          Add one URL or path per field. Path-only values resolve against this
          set’s site (e.g.{" "}
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
            disabled={saving || !drafts.some((draft) => draft.trim())}
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
