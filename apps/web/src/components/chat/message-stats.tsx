"use client";

import {
  estimateTokensFromParts,
  formatMessageStats,
  readMessageMetadata,
} from "@/lib/chat-usage";
import { cn } from "@/lib/utils";

export function MessageStats({
  parts,
  metadata,
  clientDurationMs,
  className,
}: {
  parts: Array<{ type?: string; text?: string }>;
  metadata?: unknown;
  clientDurationMs?: number;
  className?: string;
}) {
  const parsed = readMessageMetadata(metadata);
  const apiTokens = parsed?.usage?.totalTokens;
  const durationMs = parsed?.durationMs ?? clientDurationMs;
  const estimatedTokens =
    !apiTokens || apiTokens <= 0 ? estimateTokensFromParts(parts) : undefined;
  const totalTokens = apiTokens && apiTokens > 0 ? apiTokens : estimatedTokens;

  const label = formatMessageStats({
    durationMs,
    totalTokens,
    estimatedTokens: !apiTokens && Boolean(estimatedTokens),
  });

  if (!label) return null;

  return (
    <p
      className={cn(
        "font-mono text-[0.625rem] tabular-nums tracking-wide text-muted",
        className,
      )}
    >
      {label}
    </p>
  );
}
