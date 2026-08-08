import type { LanguageModelUsage } from "ai";
import { encode } from "gpt-tokenizer";

export type ChatMessageMetadata = {
  usage?: LanguageModelUsage;
  durationMs?: number;
};

export function normalizeChatUsage(raw: unknown): LanguageModelUsage | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const source = raw as Record<string, unknown>;
  const toCount = (value: unknown) => {
    const n = Number(value ?? 0);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  };

  const inputTokens = toCount(
    source.inputTokens ?? source.input_tokens ?? source.promptTokens,
  );
  const outputTokens = toCount(
    source.outputTokens ?? source.output_tokens ?? source.completionTokens,
  );
  const reasoningTokens = toCount(
    source.reasoningTokens ?? source.reasoning_tokens,
  );
  const cachedInputTokens = toCount(
    source.cachedInputTokens ?? source.cached_input_tokens,
  );
  const totalTokens = toCount(
    source.totalTokens ??
      source.total_tokens ??
      inputTokens + outputTokens + reasoningTokens + cachedInputTokens,
  );

  if (totalTokens <= 0 && inputTokens <= 0 && outputTokens <= 0) {
    return undefined;
  }

  return {
    inputTokens,
    outputTokens,
    reasoningTokens,
    cachedInputTokens,
    totalTokens: totalTokens || inputTokens + outputTokens + reasoningTokens,
  };
}

export function readMessageMetadata(
  metadata: unknown,
): ChatMessageMetadata | undefined {
  if (!metadata || typeof metadata !== "object") return undefined;
  const source = metadata as Record<string, unknown>;
  const usage = normalizeChatUsage(source.usage);
  const durationMs = Number(source.durationMs ?? source.duration_ms ?? 0);
  if (!usage && (!Number.isFinite(durationMs) || durationMs <= 0)) {
    return undefined;
  }
  return {
    ...(usage ? { usage } : {}),
    ...(Number.isFinite(durationMs) && durationMs > 0 ? { durationMs } : {}),
  };
}

function partText(part: { type?: string; text?: string }): string {
  if (part.type === "text" || part.type === "reasoning") {
    return String(part.text ?? "");
  }
  return "";
}

/** Rough client estimate when the API does not return usage metadata. */
export function estimateTokensFromParts(
  parts: Array<{ type?: string; text?: string }>,
): number {
  let chars = 0;
  for (const part of parts) {
    chars += partText(part).length;
  }
  if (chars <= 0) return 0;
  try {
    const text = parts.map((part) => partText(part)).join("\n\n");
    return encode(text).length;
  } catch {
    return Math.ceil(chars / 4);
  }
}

export function formatDurationMs(durationMs: number): string {
  if (durationMs < 1000) return `${Math.max(1, Math.round(durationMs))}ms`;
  const seconds = durationMs / 1000;
  if (seconds < 10) return `${seconds.toFixed(1)}s`;
  return `${Math.round(seconds)}s`;
}

export function formatTokenCount(tokens: number, estimated = false): string {
  const formatted = new Intl.NumberFormat("en-US").format(Math.max(0, tokens));
  return estimated ? `~${formatted} tokens (est.)` : `${formatted} tokens`;
}

export function formatMessageStats(input: {
  durationMs?: number;
  totalTokens?: number;
  estimatedTokens?: boolean;
}): string | null {
  const parts: string[] = [];
  if (input.durationMs && input.durationMs > 0) {
    parts.push(formatDurationMs(input.durationMs));
  }
  if (input.totalTokens && input.totalTokens > 0) {
    parts.push(formatTokenCount(input.totalTokens, input.estimatedTokens));
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}
