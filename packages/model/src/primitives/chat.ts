/**
 * LlamaChatSession-based prompt / stream helpers over the currently mounted runtime.
 */
import { LlamaChatSession, type LlamaGrammar, type LlamaJsonSchemaGrammar, type Token } from "node-llama-cpp";
import { thoughtTokensFromRequest } from "../reasoning.js";
import type { BenchmarkMetrics, MountedRuntime, ReasoningEffort } from "../types.js";
import { getMountedRuntime, mount } from "./mount.js";

export type ChatGrammar = LlamaGrammar | LlamaJsonSchemaGrammar<never>;

export type ChatPromptOptions = {
  prompt: string;
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
  thoughtTokens?: number;
  reasoningEffort?: ReasoningEffort;
  grammar?: ChatGrammar;
  /** Reuses the mounted runtime's context by default; auto-disposes the sequence when set. */
  autoDisposeSequence?: boolean;
  onToken?: (tokens: Token[]) => void;
  onTextChunk?: (chunk: string) => void;
};

export type ChatPromptResult = {
  text: string;
  metrics: BenchmarkMetrics;
};

export function computeMetrics(options: {
  startMs: number;
  firstTokenMs: number | null;
  endMs: number;
  tokenCount: number;
}): BenchmarkMetrics {
  const { startMs, firstTokenMs, endMs, tokenCount } = options;
  const first = firstTokenMs ?? endMs;
  const totalDurationSec = (endMs - startMs) / 1000;
  const generationDurationSec = Math.max((endMs - first) / 1000, 1e-6);
  return {
    ttftMs: first - startMs,
    tokenCount,
    tokensPerSec: tokenCount / generationDurationSec,
    totalDurationSec,
    generationDurationSec,
  };
}

export function printMetrics(metrics: BenchmarkMetrics): void {
  console.log("\n-----------------------------------------");
  console.log("PERFORMANCE RESULTS");
  console.log("-----------------------------------------");
  console.log(`TTFT                      : ${metrics.ttftMs.toFixed(2)} ms`);
  console.log(`Total tokens generated    : ${metrics.tokenCount}`);
  console.log(`Generation speed          : ${metrics.tokensPerSec.toFixed(2)} tokens/sec`);
  console.log(`Total duration            : ${metrics.totalDurationSec.toFixed(2)} s`);
  console.log("-----------------------------------------\n");
}

async function ensureRuntime(): Promise<MountedRuntime> {
  return getMountedRuntime() ?? mount();
}

/** Create a chat session bound to a fresh sequence over the mounted runtime's context. */
export async function createChatSession(options?: {
  systemPrompt?: string;
  autoDisposeSequence?: boolean;
}): Promise<{ session: LlamaChatSession; runtime: MountedRuntime }> {
  const runtime = await ensureRuntime();
  const session = new LlamaChatSession({
    contextSequence: runtime.context.getSequence(),
    systemPrompt: options?.systemPrompt,
    autoDisposeSequence: options?.autoDisposeSequence ?? false,
  });
  return { session, runtime };
}

/** Run a single non-streamed prompt and return the response text + timing metrics. */
export async function chatPrompt(options: ChatPromptOptions): Promise<ChatPromptResult> {
  const { session } = await createChatSession({
    systemPrompt: options.systemPrompt,
    autoDisposeSequence: options.autoDisposeSequence,
  });

  const thoughtTokens = thoughtTokensFromRequest(options);
  let tokenCount = 0;
  let firstTokenMs: number | null = null;
  const startMs = performance.now();

  try {
    const text = await session.prompt(options.prompt, {
      maxTokens: options.maxTokens,
      temperature: options.temperature,
      budgets: { thoughtTokens },
      grammar: options.grammar as LlamaGrammar | undefined,
      onToken(tokens) {
        if (firstTokenMs == null) firstTokenMs = performance.now();
        tokenCount += tokens.length;
        options.onToken?.(tokens);
      },
      onTextChunk: options.onTextChunk,
    });

    const endMs = performance.now();
    return { text, metrics: computeMetrics({ startMs, firstTokenMs, endMs, tokenCount }) };
  } finally {
    if (options.autoDisposeSequence) {
      session.dispose();
    }
  }
}

/** A minimal push-based async queue used to bridge callback APIs into an async generator. */
function createPushQueue<T>(): {
  push: (value: T) => void;
  end: () => void;
  fail: (error: unknown) => void;
  next: () => Promise<IteratorResult<T, void>>;
} {
  const buffered: T[] = [];
  let waiting: ((result: IteratorResult<T, void>) => void) | undefined;
  let finished = false;
  let failure: unknown;

  return {
    push(value) {
      if (waiting) {
        const resolve = waiting;
        waiting = undefined;
        resolve({ value, done: false });
        return;
      }
      buffered.push(value);
    },
    end() {
      finished = true;
      if (waiting) {
        const resolve = waiting;
        waiting = undefined;
        resolve({ value: undefined, done: true });
      }
    },
    fail(error) {
      failure = error;
      this.end();
    },
    next() {
      if (buffered.length > 0) {
        return Promise.resolve({ value: buffered.shift() as T, done: false });
      }
      if (finished) {
        if (failure) return Promise.reject(failure);
        return Promise.resolve({ value: undefined, done: true });
      }
      return new Promise((resolve) => {
        waiting = resolve;
      });
    },
  };
}

/** Stream a prompt, yielding text chunks as they're generated. */
export async function* chatStream(
  options: ChatPromptOptions,
): AsyncGenerator<string, ChatPromptResult, void> {
  const { session } = await createChatSession({
    systemPrompt: options.systemPrompt,
    autoDisposeSequence: options.autoDisposeSequence,
  });

  const thoughtTokens = thoughtTokensFromRequest(options);
  const chunks: string[] = [];
  const queue = createPushQueue<string>();
  let tokenCount = 0;
  let firstTokenMs: number | null = null;
  const startMs = performance.now();

  const promptPromise = session
    .prompt(options.prompt, {
      maxTokens: options.maxTokens,
      temperature: options.temperature,
      budgets: { thoughtTokens },
      grammar: options.grammar as LlamaGrammar | undefined,
      onToken(tokens) {
        if (firstTokenMs == null) firstTokenMs = performance.now();
        tokenCount += tokens.length;
        options.onToken?.(tokens);
      },
      onTextChunk(chunk) {
        chunks.push(chunk);
        queue.push(chunk);
        options.onTextChunk?.(chunk);
      },
    })
    .then(() => {
      queue.end();
    })
    .catch((error: unknown) => {
      queue.fail(error);
    });

  try {
    while (true) {
      const result = await queue.next();
      if (result.done) break;
      yield result.value;
    }
    await promptPromise;
  } finally {
    if (options.autoDisposeSequence) {
      session.dispose();
    }
  }

  const endMs = performance.now();
  return {
    text: chunks.join(""),
    metrics: computeMetrics({ startMs, firstTokenMs, endMs, tokenCount }),
  };
}
