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
  | "local"
  | "local-v2"
  | "local-auto"
  | "local-mini"
  | "local-mini-l12"
  | "vector";

const LOCAL_CE_BACKENDS = new Set<RerankBackend>([
  "local",
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
  "local",
  "local-v2",
  "local-auto",
  "local-mini",
  "local-mini-l12",
  "vector",
]);

export function resolveRerankBackend(): RerankBackend {
  // Cloud-hosted indexes: fixed fast path — Cohere Auto + Gemini embeds.
  if (preferCloudRetrieval()) return "cohere-auto";

  const requestOverride = getRequestRerankBackend();
  if (requestOverride) return requestOverride;

  const explicit = process.env.LEDGEINDEX_RERANK_BACKEND?.toLowerCase();
  if (explicit && KNOWN_BACKENDS.has(explicit)) {
    return explicit as RerankBackend;
  }

  // Local indexes: never silently escalate to Cohere just because a key exists.
  // The UI Local/Cloud toggle must opt into cloud rerank via request override.
  return "local-auto";
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

  const backend = resolveRerankBackend();
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
}): Promise<RerankResult[]> {
  const backend = resolveRerankBackend();
  const topK = input.topK ?? SEARCH_TOP_K;

  if (input.results.length === 0) return [];

  logVerbose("Kapa rerank backend", "KapaRerank", {
    backend,
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

    case "local":
      return runLocalWithVectorFallback(rerankInput);

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
