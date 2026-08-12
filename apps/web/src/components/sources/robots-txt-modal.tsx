"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  fetchRobotsTxt,
  KnowledgeIndexApiError,
} from "@/lib/ledgeindex-api";

export function RobotsTxtModal({
  open,
  startUrl,
  robotsUrl,
  onClose,
}: {
  open: boolean;
  /** Start URL or site URL — used to resolve /robots.txt. */
  startUrl: string;
  /** Known robots.txt URL from preflight when available. */
  robotsUrl?: string | null;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(null);
  const [found, setFound] = useState(false);

  useEffect(() => {
    if (!open) return;
    const target = robotsUrl?.trim() || startUrl.trim();
    if (!target) {
      setError("No URL to load robots.txt from.");
      setText("");
      setFound(false);
      setResolvedUrl(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    void fetchRobotsTxt({ url: target })
      .then((result) => {
        if (cancelled) return;
        setResolvedUrl(result.url);
        setFound(result.found);
        setText(result.text);
        if (!result.found) {
          setError(
            result.status
              ? `HTTP ${result.status} — robots.txt not found.`
              : "robots.txt not found.",
          );
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setFound(false);
        setText("");
        setError(
          err instanceof KnowledgeIndexApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : "Failed to load robots.txt",
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, startUrl, robotsUrl]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="robots-txt-title"
        className="flex max-h-[min(40rem,92dvh)] w-full max-w-2xl flex-col rounded-xl border border-border bg-card-solid shadow-card"
      >
        <div className="border-b border-border px-5 py-4">
          <h2
            id="robots-txt-title"
            className="text-base font-semibold text-foreground"
          >
            robots.txt
          </h2>
          {resolvedUrl ? (
            <a
              href={resolvedUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 block truncate font-mono text-[0.75rem] text-muted hover:text-foreground hover:underline"
            >
              {resolvedUrl}
            </a>
          ) : null}
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
          {loading ? (
            <p className="text-sm text-muted">Loading…</p>
          ) : error && !found ? (
            <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
          ) : (
            <pre className="whitespace-pre-wrap break-all font-mono text-[0.75rem] leading-5 text-foreground">
              {text}
            </pre>
          )}
        </div>

        <div className="flex justify-end border-t border-border px-5 py-3">
          <Button type="button" onClick={onClose} className="h-9 px-4 text-xs">
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
