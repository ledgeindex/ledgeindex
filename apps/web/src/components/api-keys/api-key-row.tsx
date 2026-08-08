"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { maskApiKey } from "@/lib/mask-api-key";
import { cn } from "@/lib/utils";
import type { ApiKeySummary } from "@/lib/ledgeindex-api";

export function ApiKeyRow({
  apiKey,
  canRevoke,
  deleting,
  onRevoke,
}: {
  apiKey: ApiKeySummary;
  canRevoke: boolean;
  deleting: boolean;
  onRevoke?: (keyId: string) => void;
}) {
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const fullValue = apiKey.key_value;
  const displayValue = fullValue
    ? revealed
      ? fullValue
      : maskApiKey(fullValue)
    : apiKey.key_prefix;

  async function handleCopy() {
    if (!fullValue) return;
    try {
      await navigator.clipboard.writeText(fullValue);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  }

  return (
    <article className="overflow-hidden rounded-xl border border-border bg-card-solid shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 bg-surface-raised/50 px-4 py-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <p className="text-sm font-medium text-foreground">{apiKey.name}</p>
          {apiKey.is_default ? (
            <span className="rounded-md border border-border bg-background px-1.5 py-0.5 font-mono text-[0.5rem] font-semibold tracking-[0.08em] text-muted uppercase">
              Primary
            </span>
          ) : null}
        </div>
        <p className="font-mono text-[0.625rem] text-muted">
          {new Date(apiKey.created_at).toLocaleString(undefined, {
            dateStyle: "medium",
            timeStyle: "short",
          })}
        </p>
      </div>

      <div className="space-y-3 p-4">
        <div>
          <label className="mb-1.5 block font-mono text-[0.5625rem] font-semibold tracking-[0.12em] text-muted uppercase">
            API key
          </label>
          <div className="flex flex-wrap items-stretch gap-2">
            <div
              className={cn(
                "field-input min-w-0 flex-1 font-mono text-xs leading-5",
                !revealed && "tracking-wide text-muted-strong",
              )}
            >
              <span className="block truncate">{displayValue}</span>
            </div>
            {fullValue ? (
              <>
                <button
                  type="button"
                  onClick={() => setRevealed((current) => !current)}
                  className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-muted transition-colors hover:bg-surface-raised hover:text-foreground"
                  aria-label={revealed ? "Hide API key" : "Show API key"}
                >
                  {revealed ? (
                    <EyeOff className="size-4" />
                  ) : (
                    <Eye className="size-4" />
                  )}
                </button>
                <Button
                  variant="secondary"
                  className="h-10 shrink-0 rounded-lg px-4 text-xs"
                  onClick={() => void handleCopy()}
                >
                  {copied ? "Copied" : "Copy"}
                </Button>
              </>
            ) : null}
          </div>
        </div>

        {canRevoke && !apiKey.is_default && onRevoke ? (
          <div className="flex justify-end">
            <Button
              variant="secondary"
              className="h-9 rounded-lg px-3 text-xs text-red-600 dark:text-red-300"
              disabled={deleting}
              onClick={() => onRevoke(apiKey.id)}
            >
              {deleting ? "Revoking…" : "Revoke"}
            </Button>
          </div>
        ) : null}
      </div>
    </article>
  );
}
