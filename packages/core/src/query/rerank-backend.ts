import type { QueryResult } from "@mastra/core/vector";
import type { RerankResult } from "@mastra/rag";
import { CohereRelevanceScorer, rerankWithScorer } from "@mastra/rag";
import { logVerbose, logWarn } from "../lib/logger.js";
import { getRequestRerankBackend, preferCloudRetrieval } from "./rerank-request-context.js";
import {
  SEARCH_RERANK_CANDIDATES,
  SEARCH_RERANK_CANDIDATES_LOCAL,
  SEARCH_RERANK_WEIGHTS,
  SEARCH_TOP_K,
} from "../vector/constants.js";
import { batchLlmRerank } from "./batch-relevance-scorer.js";
import {
  COHERE_RERANK_MODEL_V35,
  COHERE_RERANK_MODEL_V4_FAST,
  cohereBatchRerank,
  getCohereRerankModel,
  hasCohereKey,
} from "./cohere-batch-rerank.js";
import { getLocalRerankUrl, localBatchRerank } from "./local-batch-rerank.js";
import {
  getInProcessLocalRerankStatus,
  LOCAL_RERANK_MODEL_MINILM,
  LOCAL_RERANK_MODEL_MINILM_L12,
  LOCAL_RERANK_MODEL_V2_M3,
  preferInProcessLocalRerank,
} from "./local-bge-inprocess.js";
import {
  cohereAutoBatchRerank,
  localAutoBatchRerankOrFallback,
} from "./rerank-auto.js";
import { vectorOnlyRerank } from "./weighted-rerank.js";

export type RerankBackend =
  | "cohere"
  | "cohere-auto"
  | "cohere-v4-fast"
  | "cohere-mastra"
  | "llm-batch"
  | "local-v2"
  | "local-auto"
  | "local-mini"
  | "local-mini-l12"
  | "vector";

const LOCAL_CE_BACKENDS = new Set<RerankBackend>([
  "local-v2",
  "local-auto",
  "local-mini",
  "local-mini-l12",
]);

const COHERE_BACKENDS = new Set<RerankBackend>([
  "cohere",
  "cohere-auto",
  "cohere-v4-fast",
]);

const KNOWN_BACKENDS = new Set<string>([
  "cohere",
  "cohere-auto",
  "cohere-v4-fast",
  "cohere-mastra",
  "llm-batch",
  "local-v2",
  "local-auto",
  "local-mini",
  "local-mini-l12",
  "vector",
]);

/**
 * The backend, plus whether anything actually asked for it. A default may be
 * overridden by what the candidates turn out to be; an explicit choice may not.
 */
export function resolveRerankBackendSelection(): {
  backend: RerankBackend;
  explicit: boolean;
} {
  // Cloud-hosted indexes: fixed fast path — Cohere Auto + Gemini embeds.
  if (preferCloudRetrieval()) return { backend: "cohere-auto", explicit: true };

  const requestOverride = getRequestRerankBackend();
  if (requestOverride) return { backend: requestOverride, explicit: true };

  const configured = process.env.LEDGEINDEX_RERANK_BACKEND?.toLowerCase();
  if (configured && KNOWN_BACKENDS.has(configured)) {
    return { backend: configured as RerankBackend, explicit: true };
  }

  // Local indexes: never silently escalate to Cohere just because a key exists.
  // The UI Local/Cloud toggle must opt into cloud rerank via request override.
  return { backend: "local-auto", explicit: false };
}

export function resolveRerankBackend(): RerankBackend {
  return resolveRerankBackendSelection().backend;
}

/**
 * Share of candidates carrying code metadata above which a source counts as a
 * code source. Well clear of a docs source that happens to include a few
 * fenced examples, and well below a repo whose docs pages are indexed too.
 */
const CODE_CANDIDATE_RATIO = 0.6;

function skipCrossEncoderForCode(): boolean {
  const raw =
    process.env.LEDGEINDEX_CODE_SKIP_CROSS_ENCODER?.trim().toLowerCase();
  if (!raw) return true;
  return raw !== "0" && raw !== "false" && raw !== "off";
}

/**
 * Which backend should actually score a candidate pool that looks like code.
 *
 * The cross-encoders in use are trained on prose, and on the Stagehand golden
 * set the local one is worse than the fused order at every depth past rank 1,
 * costs four times the latency, and — because its scores are low on code while
 * carrying half the weight in the blend — pushes correct chunks under
 * `RELEVANCE_THRESHOLD`, where they are discarded rather than merely demoted.
 * Measured on the production path: recall@8 of 77.8% with the cross-encoder
 * against 100% without, three of four misses being answers the ranking found
 * and the threshold then dropped.
 *
 * So for code, ranking is the fused order. An explicit choice still wins, and
 * `LEDGEINDEX_CODE_SKIP_CROSS_ENCODER=0` restores the old behaviour.
 */
export function effectiveRerankBackend(codeCandidateRatio: number): {
  backend: RerankBackend;
  codeSourceOverride: boolean;
} {
  const selection = resolveRerankBackendSelection();
  if (
    !selection.explicit &&
    skipCrossEncoderForCode() &&
    codeCandidateRatio >= CODE_CANDIDATE_RATIO
  ) {
    return { backend: "vector", codeSourceOverride: true };
  }
  return { backend: selection.backend, codeSourceOverride: false };
}

/**
 * How many vector hits to score in the reranker.
 * Local CE defaults lower (CPU); Cohere keeps the wide 50 pull.
 * Override: `LEDGEINDEX_RERANK_CANDIDATES=N`
 */
export function getSearchRerankCandidates(
  backend = resolveRerankBackend(),
): number {
  const raw = process.env.LEDGEINDEX_RERANK_CANDIDATES?.trim();
  if (raw) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed >= 1) {
      return Math.min(100, Math.floor(parsed));
    }
  }
  if (LOCAL_CE_BACKENDS.has(backend)) return SEARCH_RERANK_CANDIDATES_LOCAL;
  return SEARCH_RERANK_CANDIDATES;
}

export function describeRerankSetup(): {
  backend: RerankBackend;
  cohereKey: boolean;
  cohereModel: string;
  localRerankUrl: string;
  localInProcess: boolean;
  localInProcessStatus: ReturnType<typeof getInProcessLocalRerankStatus>;
  fallbackChain: string[];
} {
  const backend = resolveRerankBackend();
  const fallbackChain = COHERE_BACKENDS.has(backend)
    ? [backend, "local-auto", "vector"]
    : LOCAL_CE_BACKENDS.has(backend)
      ? [backend, "vector"]
      : [backend];

  return {
    backend,
    cohereKey: hasCohereKey(),
    cohereModel: getCohereRerankModel(),
    localRerankUrl: getLocalRerankUrl(),
    localInProcess: preferInProcessLocalRerank(),
    localInProcessStatus: getInProcessLocalRerankStatus(),
    fallbackChain,
  };
}

function labelForLocalDevice(device: string | null | undefined): string {
  switch ((device ?? "").toLowerCase()) {
    case "dml":
      return "GPU (DirectML)";
    case "cuda":
      return "GPU (CUDA)";
    case "webgpu":
      return "GPU (WebGPU)";
    case "gpu":
      return "GPU";
    case "cpu":
    case "wasm":
      return "CPU";
    default:
      return device ? device.toUpperCase() : "CPU";
  }
}

/**
 * Snapshot of which rerank path ran — attach to retrieval meta for the chat UI.
 * Call after retrieve/rerank so local CE device status is populated.
 */
export function describeRerankRuntimeMeta(options?: {
  cascadePassUsed?: boolean;
  /**
   * What actually ran, when it differs from what the config resolves to — a code
   * source overrides the default backend, and the UI should say so rather than
   * report the backend that was configured but skipped.
   */
  effectiveBackend?: RerankBackend;
}): {
  rerankBackend: RerankBackend | "cascade";
  rerankDevice: string | null;
  rerankDeviceLabel: string;
} {
  if (options?.cascadePassUsed) {
    return {
      rerankBackend: "cascade",
      rerankDevice: null,
      rerankDeviceLabel: "skipped (cascade)",
    };
  }

  const backend = options?.effectiveBackend ?? resolveRerankBackend();
  if (COHERE_BACKENDS.has(backend) || backend === "cohere-mastra") {
    return {
      rerankBackend: backend,
      rerankDevice: null,
      rerankDeviceLabel: "Cohere",
    };
  }
  if (backend === "llm-batch") {
    return {
      rerankBackend: backend,
      rerankDevice: null,
      rerankDeviceLabel: "LLM batch",
    };
  }
  if (backend === "vector") {
    return {
      rerankBackend: backend,
      rerankDevice: null,
      rerankDeviceLabel: "vector only",
    };
  }

  const status = getInProcessLocalRerankStatus();
  const device = status.device;
  if (!device) {
    return {
      rerankBackend: backend,
      rerankDevice: null,
      rerankDeviceLabel: preferInProcessLocalRerank()
        ? "local"
        : "local sidecar",
    };
  }
  return {
    rerankBackend: backend,
    rerankDevice: device,
    rerankDeviceLabel: labelForLocalDevice(device),
  };
}

/**
 * Kapa rerank stage — Mastra-compatible weights, backend selectable via env.
 *
 * Auto modes escalate on ambiguous CE scores:
 * - local-auto: MiniLM L6 → L12 (top-N)
 * - cohere-auto: Cohere 3.5 → 4 (fast)
 */
export async function executeKapaRerank(input: {
  query: string;
  results: QueryResult[];
  queryVector?: number[];
  topK?: number;
  /** Fraction of candidates that carry code metadata; see {@link effectiveRerankBackend}. */
  codeCandidateRatio?: number;
}): Promise<RerankResult[]> {
  const { backend, codeSourceOverride } = effectiveRerankBackend(
    input.codeCandidateRatio ?? 0,
  );
  const topK = input.topK ?? SEARCH_TOP_K;

  if (input.results.length === 0) return [];

  logVerbose("Kapa rerank backend", "KapaRerank", {
    backend,
    codeSourceOverride,
    codeCandidateRatio: input.codeCandidateRatio ?? 0,
    requestOverride: getRequestRerankBackend() ?? null,
    candidateCount: input.results.length,
    topK,
    localRerankUrl: getLocalRerankUrl(),
  });

  const rerankInput = {
    query: input.query,
    results: input.results,
    queryVector: input.queryVector,
    topK,
  };

  switch (backend) {
    case "cohere":
      return runCohereWithLocalFallback(rerankInput, COHERE_RERANK_MODEL_V35);

    case "cohere-v4-fast":
      return runCohereWithLocalFallback(
        rerankInput,
        COHERE_RERANK_MODEL_V4_FAST,
      );

    case "cohere-auto":
      try {
        return await cohereAutoBatchRerank(rerankInput);
      } catch (error) {
        logWarn(
          error instanceof Error ? error.message : "Cohere auto rerank failed",
          "KapaRerank",
          { fallback: "local-auto" },
        );
        try {
          return await localAutoBatchRerankOrFallback(rerankInput);
        } catch {
          return runLocalWithVectorFallback({
            ...rerankInput,
            modelId: LOCAL_RERANK_MODEL_MINILM,
          });
        }
      }

    case "cohere-mastra": {
      const scorer = new CohereRelevanceScorer(getCohereRerankModel());
      return rerankWithScorer({
        results: input.results,
        query: input.query,
        scorer,
        options: {
          weights: { ...SEARCH_RERANK_WEIGHTS },
          queryEmbedding: input.queryVector,
          topK,
        },
      });
    }

    case "llm-batch":
      return batchLlmRerank(rerankInput);

    case "local-v2":
      return runLocalWithVectorFallback({
        ...rerankInput,
        modelId: LOCAL_RERANK_MODEL_V2_M3,
      });

    case "local-auto":
      try {
        return await localAutoBatchRerankOrFallback(rerankInput);
      } catch (error) {
        logWarn(
          error instanceof Error ? error.message : "Local auto rerank failed",
          "KapaRerank",
          { fallback: "vector" },
        );
        return vectorOnlyRerank(input.results, topK);
      }

    case "local-mini":
      return runLocalWithVectorFallback({
        ...rerankInput,
        modelId: LOCAL_RERANK_MODEL_MINILM,
      });

    case "local-mini-l12":
      return runLocalWithVectorFallback({
        ...rerankInput,
        modelId: LOCAL_RERANK_MODEL_MINILM_L12,
      });

    case "vector":
      return vectorOnlyRerank(input.results, topK);

    default:
      return vectorOnlyRerank(input.results, topK);
  }
}

async function runCohereWithLocalFallback(
  input: {
    query: string;
    results: QueryResult[];
    topK?: number;
  },
  model: string,
): Promise<RerankResult[]> {
  try {
    return await cohereBatchRerank({ ...input, model });
  } catch (error) {
    logWarn(
      error instanceof Error ? error.message : "Cohere rerank failed",
      "KapaRerank",
      { fallback: "local-auto", model },
    );
    try {
      return await localAutoBatchRerankOrFallback(input);
    } catch {
      return runLocalWithVectorFallback({
        ...input,
        modelId: LOCAL_RERANK_MODEL_MINILM,
      });
    }
  }
}

async function runLocalWithVectorFallback(input: {
  query: string;
  results: QueryResult[];
  topK?: number;
  modelId?: string;
}): Promise<RerankResult[]> {
  try {
    return await localBatchRerank(input);
  } catch (error) {
    logWarn(
      error instanceof Error ? error.message : "Local rerank failed",
      "KapaRerank",
      { fallback: "vector", url: getLocalRerankUrl(), modelId: input.modelId },
    );
    return vectorOnlyRerank(input.results, input.topK ?? SEARCH_TOP_K);
  }
}
