import { logInfo, logVerbose, logWarn } from "../lib/logger.js";

/**
 * Explore intent waterfall:
 *   1) regex / keywords (cheap, definitive)
 *   2) DistilBERT — **only accepted on high confidence**
 *   3) else null → caller uses LLM (mode=auto)
 *
 * Labels: greetings | thanks | question
 * Pipeline: greetings|thanks → chat · question → retrieve
 *
 * Env:
 * - `LEDGEINDEX_EXPLORE_INTENT_ROUTER=llm|local|auto` (default `auto`)
 * - `LEDGEINDEX_EXPLORE_INTENT_MODEL` (default Xenova DistilBERT MNLI)
 * - `LEDGEINDEX_EXPLORE_INTENT_MIN_SCORE` (default **0.80** — DistilBERT high-confidence bar)
 * - `LEDGEINDEX_EXPLORE_INTENT_MARGIN` (default 0.15 — lead over `question` for acks)
 */

export type ExploreIntentLabel = "greetings" | "thanks" | "question";

export type ExplorePipelineIntent = "chat" | "retrieve";

export type ExploreIntentRouterMode = "llm" | "local" | "auto";

export type ExploreIntentSource = "regex" | "classifier" | "default";

export type ExploreIntentClassifierResult = {
  intent: ExploreIntentLabel;
  pipelineIntent: ExplorePipelineIntent;
  score: number;
  scores: Record<ExploreIntentLabel, number>;
  reason: string;
  modelId: string;
  source: ExploreIntentSource;
};

export type ExploreIntentWaterfallResult = {
  pipelineIntent: ExplorePipelineIntent;
  reason: string;
  label: ExploreIntentLabel;
  source: ExploreIntentSource;
  score: number;
};

export const EXPLORE_INTENT_HYPOTHESES: Record<ExploreIntentLabel, string> = {
  greetings: "saying hello or hi",
  thanks: "saying thanks or thank you",
  question: "asking a question that needs information or an explanation",
};

const DEFAULT_MODEL_ID = "Xenova/distilbert-base-uncased-mnli";
/** DistilBERT must clear this to be used; otherwise fall through to LLM. */
const DEFAULT_MIN_SCORE = 0.8;
/** Extra lead greetings/thanks need over `question` before we skip retrieve. */
const DEFAULT_MARGIN = 0.15;

const INTENT_ORDER: ExploreIntentLabel[] = [
  "greetings",
  "thanks",
  "question",
];

const GREETING_WORDS = new Set([
  "hi",
  "hello",
  "hey",
  "yo",
  "sup",
  "hallo",
  "hiya",
]);

const THANKS_WORDS = new Set([
  "thanks",
  "thank",
  "thx",
  "ty",
  "appreciated",
  "cool",
  "nice",
  "ok",
  "okay",
]);

type ZeroShotPipeline = (
  text: string,
  labels: string[],
  options?: { multi_label?: boolean },
) => Promise<{
  labels: string[];
  scores: number[];
}>;

type ClassifierSlot = {
  pipe: ZeroShotPipeline | null;
  loadPromise: Promise<ZeroShotPipeline> | null;
  loadError: string | null;
  modelId: string;
};

let slot: ClassifierSlot | null = null;

export function resolveExploreIntentRouterMode(
  raw = process.env.LEDGEINDEX_EXPLORE_INTENT_ROUTER,
): ExploreIntentRouterMode {
  const value = raw?.trim().toLowerCase();
  if (value === "llm" || value === "local" || value === "auto") return value;
  return "auto";
}

export function getExploreIntentClassifierModelId(): string {
  return (
    process.env.LEDGEINDEX_EXPLORE_INTENT_MODEL?.trim() || DEFAULT_MODEL_ID
  );
}

export function getExploreIntentMinScore(): number {
  const raw = process.env.LEDGEINDEX_EXPLORE_INTENT_MIN_SCORE?.trim();
  if (!raw) return DEFAULT_MIN_SCORE;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_MIN_SCORE;
  return Math.min(1, Math.max(0, parsed));
}

export function getExploreIntentMargin(): number {
  const raw = process.env.LEDGEINDEX_EXPLORE_INTENT_MARGIN?.trim();
  if (!raw) return DEFAULT_MARGIN;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_MARGIN;
  return Math.min(1, Math.max(0, parsed));
}

export function mapExploreIntentToPipeline(
  intent: ExploreIntentLabel,
): ExplorePipelineIntent {
  return intent === "question" ? "retrieve" : "chat";
}

export function pickExploreIntentFromScores(
  scores: Record<ExploreIntentLabel, number>,
): { intent: ExploreIntentLabel; score: number } {
  let intent: ExploreIntentLabel = "question";
  let score = -1;
  for (const label of INTENT_ORDER) {
    const value = scores[label] ?? 0;
    if (value > score) {
      score = value;
      intent = label;
    }
  }
  if (score < 0) return { intent: "question", score: 0 };
  return { intent, score };
}

function emptyScores(): Record<ExploreIntentLabel, number> {
  return { greetings: 0, thanks: 0, question: 0 };
}

/**
 * Stage 1 — cheap regex / keyword gate.
 * Returns a decision only when confident; otherwise null → DistilBERT.
 */
export function classifyExploreIntentRegex(
  text: string,
): ExploreIntentClassifierResult | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const lower = trimmed.toLowerCase();
  const compact = lower.replace(/[.!?]+$/u, "").trim();
  const tokens = compact.split(/[^a-z0-9]+/i).filter(Boolean);
  if (tokens.length === 0) return null;

  const scores = emptyScores();

  // Clear short greetings: "hi", "hello!", "hey there"
  if (
    tokens.length <= 2 &&
    tokens.every((t) => GREETING_WORDS.has(t) || t === "there")
  ) {
    scores.greetings = 0.98;
    return {
      intent: "greetings",
      pipelineIntent: "chat",
      score: 0.98,
      scores: { ...scores, greetings: 0.98 },
      reason: "Regex → greetings→chat",
      modelId: "regex",
      source: "regex",
    };
  }

  // Clear short thanks / soft acks: "thanks", "thank you", "cool", "ok"
  const thanksOnly = tokens.every(
    (t) => THANKS_WORDS.has(t) || t === "you" || t === "it" || t === "vm",
  );
  if (tokens.length <= 4 && thanksOnly && tokens.some((t) => THANKS_WORDS.has(t))) {
    scores.thanks = 0.95;
    return {
      intent: "thanks",
      pipelineIntent: "chat",
      score: 0.95,
      scores: { ...scores, thanks: 0.95 },
      reason: "Regex → thanks→chat",
      modelId: "regex",
      source: "regex",
    };
  }

  // Clear questions: ends with ? or starts with interrogative / modal
  const startsAsk =
    /^(who|what|where|when|why|how|can|is|does|do|are|should|could|would|which|whose)\b/i.test(
      compact,
    );
  if (/\?\s*$/.test(trimmed) || startsAsk) {
    scores.question = 0.95;
    return {
      intent: "question",
      pipelineIntent: "retrieve",
      score: 0.95,
      scores: { ...scores, question: 0.95 },
      reason: "Regex → question→retrieve",
      modelId: "regex",
      source: "regex",
    };
  }

  // Long wall of text without ack markers → treat as content/question (retrieve)
  if (tokens.length >= 25) {
    scores.question = 0.7;
    return {
      intent: "question",
      pipelineIntent: "retrieve",
      score: 0.7,
      scores: { ...scores, question: 0.7 },
      reason: "Regex → long text→question→retrieve",
      modelId: "regex",
      source: "regex",
    };
  }

  return null;
}

async function loadClassifier(modelId: string): Promise<ZeroShotPipeline> {
  if (slot?.pipe && slot.modelId === modelId) return slot.pipe;
  if (slot?.loadError && slot.modelId === modelId) {
    throw new Error(slot.loadError);
  }
  if (slot?.loadPromise && slot.modelId === modelId) {
    return slot.loadPromise;
  }

  slot = {
    pipe: null,
    loadPromise: null,
    loadError: null,
    modelId,
  };

  slot.loadPromise = (async () => {
    logInfo("Loading explore intent zero-shot classifier", "ExploreIntent", {
      modelId,
    });
    const transformers = await import("@huggingface/transformers");
    transformers.env.allowLocalModels = true;
    transformers.env.useBrowserCache = false;

    const pipe = (await transformers.pipeline(
      "zero-shot-classification",
      modelId,
      { dtype: "q8" },
    )) as unknown as ZeroShotPipeline;

    slot!.pipe = pipe;
    logInfo("Explore intent classifier ready", "ExploreIntent", { modelId });
    return pipe;
  })().catch((error) => {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to load explore intent classifier";
    if (slot) {
      slot.loadError = message;
      slot.loadPromise = null;
    }
    logWarn(message, "ExploreIntent", { modelId });
    throw error instanceof Error ? error : new Error(message);
  });

  return slot.loadPromise;
}

/** Stage 2 — DistilBERT (or configured) zero-shot classifier. */
export async function classifyExploreIntent(input: {
  question: string;
  history?: string;
}): Promise<ExploreIntentClassifierResult | null> {
  const question = input.question.trim();
  if (!question) return null;

  const modelId = getExploreIntentClassifierModelId();
  try {
    const pipe = await loadClassifier(modelId);
    const candidateLabels = INTENT_ORDER.map(
      (intent) => EXPLORE_INTENT_HYPOTHESES[intent],
    );
    const output = await pipe(question, candidateLabels, {
      multi_label: false,
    });

    const scores = emptyScores();
    for (let i = 0; i < output.labels.length; i++) {
      const hypothesis = output.labels[i];
      const value = output.scores[i] ?? 0;
      const intent = INTENT_ORDER.find(
        (key) => EXPLORE_INTENT_HYPOTHESES[key] === hypothesis,
      );
      if (intent) scores[intent] = value;
    }

    const { intent, score } = pickExploreIntentFromScores(scores);
    const pipelineIntent = mapExploreIntentToPipeline(intent);
    const result: ExploreIntentClassifierResult = {
      intent,
      pipelineIntent,
      score,
      scores,
      modelId,
      source: "classifier",
      reason: `Classifier (${modelId.split("/").pop()}) → ${intent}→${pipelineIntent} (${score.toFixed(2)})`,
    };

    logVerbose("Explore intent classified", "ExploreIntent", {
      intent: result.intent,
      pipelineIntent: result.pipelineIntent,
      score: result.score,
      scores: result.scores,
    });

    return result;
  } catch (error) {
    logWarn(
      error instanceof Error
        ? error.message
        : "Explore intent classification failed",
      "ExploreIntent",
    );
    return null;
  }
}

/**
 * DistilBERT trust gate — only high-confidence hits are used.
 * Regex results always pass.
 *
 * - question: score >= minScore AND lead over best non-question >= margin/2
 * - greetings/thanks: score >= minScore AND lead over question >= margin
 */
export function shouldTrustExploreIntentClassifier(
  result: ExploreIntentClassifierResult,
  minScore = getExploreIntentMinScore(),
  margin = getExploreIntentMargin(),
): boolean {
  if (result.source === "regex") return true;
  if (result.score < minScore) return false;

  if (result.intent === "question") {
    const second = Math.max(
      result.scores.greetings ?? 0,
      result.scores.thanks ?? 0,
    );
    return result.score - second >= margin * 0.5;
  }

  // greetings / thanks — only skip retrieval when clearly ahead of question
  const lead = result.score - (result.scores.question ?? 0);
  return lead >= margin;
}

/**
 * Waterfall: regex → DistilBERT (high confidence only) → null (LLM in auto).
 *
 * - `llm`   — always null (skip local stages)
 * - `local` — regex + high-confidence classifier; else default retrieve
 * - `auto`  — regex + high-confidence classifier; else null for LLM
 */
export async function routeExploreIntentWaterfall(input: {
  question: string;
  history?: string;
  mode?: ExploreIntentRouterMode;
}): Promise<ExploreIntentWaterfallResult | null> {
  const mode = input.mode ?? resolveExploreIntentRouterMode();
  if (mode === "llm") return null;

  const text = input.question.trim();
  if (!text) return null;

  // 1) Regex — definitive cheap hits
  const regexHit = classifyExploreIntentRegex(text);
  if (regexHit) {
    logVerbose("Explore intent from regex", "ExploreIntent", {
      intent: regexHit.intent,
      pipelineIntent: regexHit.pipelineIntent,
    });
    return {
      pipelineIntent: regexHit.pipelineIntent,
      reason: regexHit.reason,
      label: regexHit.intent,
      source: "regex",
      score: regexHit.score,
    };
  }

  // 2) DistilBERT — only if high confidence
  const classified = await classifyExploreIntent({
    question: text,
    history: input.history,
  });

  if (classified && shouldTrustExploreIntentClassifier(classified)) {
    logVerbose("Explore intent from DistilBERT (high confidence)", "ExploreIntent", {
      intent: classified.intent,
      score: classified.score,
      pipelineIntent: classified.pipelineIntent,
    });
    return {
      pipelineIntent: classified.pipelineIntent,
      reason: classified.reason,
      label: classified.intent,
      source: "classifier",
      score: classified.score,
    };
  }

  if (classified) {
    logVerbose(
      "DistilBERT below confidence bar — not used",
      "ExploreIntent",
      {
        label: classified.intent,
        score: classified.score,
        minScore: getExploreIntentMinScore(),
        scores: classified.scores,
      },
    );
  }

  if (mode === "local") {
    const label = classified?.intent ?? "question";
    const score = classified?.score ?? 0;
    return {
      pipelineIntent: "retrieve",
      reason: classified
        ? `Classifier low confidence (${label} ${score.toFixed(2)}); defaulting to question/retrieve.`
        : "Classifier unavailable; defaulting to question/retrieve.",
      label: "question",
      source: "default",
      score,
    };
  }

  // 3) auto → LLM (caller)
  return null;
}

/** @deprecated Prefer routeExploreIntentWaterfall */
export function resolveExploreClassifierDecision(
  result: ExploreIntentClassifierResult,
  mode: ExploreIntentRouterMode,
): { pipelineIntent: ExplorePipelineIntent; reason: string } | null {
  if (mode === "llm") return null;
  if (shouldTrustExploreIntentClassifier(result)) {
    return {
      pipelineIntent: result.pipelineIntent,
      reason: result.reason,
    };
  }
  if (mode === "local") {
    return {
      pipelineIntent: "retrieve",
      reason: `Local classifier ambiguous (${result.intent} ${result.score.toFixed(2)}); defaulting to question/retrieve.`,
    };
  }
  return null;
}
