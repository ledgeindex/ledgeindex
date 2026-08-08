export type NormalizedTokenUsage = {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
};

const ZERO_USAGE: NormalizedTokenUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cachedInputTokens: 0,
  reasoningTokens: 0,
  totalTokens: 0,
};

export function normalizeUsageRecord(raw: unknown): NormalizedTokenUsage | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const inputTokens = Number(
    r.inputTokens ?? r.promptTokens ?? r.prompt_tokens ?? r.promptTokenCount ?? 0,
  );
  const outputTokens = Number(
    r.outputTokens ??
      r.completionTokens ??
      r.completion_tokens ??
      r.candidatesTokenCount ??
      0,
  );
  const cachedInputTokens = Number(
    r.cachedInputTokens ??
      r.cached_input_tokens ??
      r.cachedContentTokenCount ??
      r.cachedTokens ??
      r.cached_tokens ??
      0,
  );
  const reasoningTokens = Number(
    r.reasoningTokens ??
      r.reasoning_tokens ??
      r.thoughtsTokenCount ??
      r.reasoningTokenCount ??
      0,
  );
  const totalTokens = Number(
    r.totalTokens ??
      r.total_tokens ??
      r.totalTokenCount ??
      inputTokens + outputTokens + cachedInputTokens + reasoningTokens,
  );

  return {
    inputTokens,
    outputTokens,
    cachedInputTokens,
    reasoningTokens,
    totalTokens,
  };
}

export function usageHasCounts(usage: NormalizedTokenUsage): boolean {
  return (
    usage.inputTokens > 0 ||
    usage.outputTokens > 0 ||
    usage.cachedInputTokens > 0 ||
    usage.reasoningTokens > 0 ||
    usage.totalTokens > 0
  );
}

export function mergeUsageRecords(
  a?: NormalizedTokenUsage,
  b?: NormalizedTokenUsage,
): NormalizedTokenUsage | undefined {
  if (!a && !b) return undefined;
  const aa = a ?? ZERO_USAGE;
  const bb = b ?? ZERO_USAGE;
  const inputTokens = aa.inputTokens + bb.inputTokens;
  const outputTokens = aa.outputTokens + bb.outputTokens;
  const cachedInputTokens = aa.cachedInputTokens + bb.cachedInputTokens;
  const reasoningTokens = aa.reasoningTokens + bb.reasoningTokens;
  const totalTokens =
    inputTokens + outputTokens + cachedInputTokens + reasoningTokens;
  return {
    inputTokens,
    outputTokens,
    cachedInputTokens,
    reasoningTokens,
    totalTokens,
  };
}

export function coalesceStreamUsage(options: {
  finishUsage?: NormalizedTokenUsage;
  stepUsage?: NormalizedTokenUsage;
}): NormalizedTokenUsage | undefined {
  const parts = [options.finishUsage, options.stepUsage].filter(
    (usage): usage is NormalizedTokenUsage =>
      Boolean(usage && usageHasCounts(usage)),
  );
  if (parts.length === 0) return undefined;
  if (parts.length === 1) return parts[0];

  return {
    inputTokens: Math.max(...parts.map((u) => u.inputTokens)),
    outputTokens: Math.max(...parts.map((u) => u.outputTokens)),
    cachedInputTokens: Math.max(...parts.map((u) => u.cachedInputTokens)),
    reasoningTokens: Math.max(...parts.map((u) => u.reasoningTokens)),
    totalTokens: Math.max(...parts.map((u) => u.totalTokens)),
  };
}
