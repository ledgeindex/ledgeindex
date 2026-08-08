import { logInfo, logVerbose, logWarn } from "../lib/logger.js";

/** Current default — small Transformers.js port. */
export const LOCAL_RERANK_MODEL_BASE = "Xenova/bge-reranker-base";

/**
 * Stronger multilingual cross-encoder (ONNX for Transformers.js).
 * @see https://huggingface.co/onnx-community/bge-reranker-v2-m3-ONNX
 */
export const LOCAL_RERANK_MODEL_V2_M3 =
  "onnx-community/bge-reranker-v2-m3-ONNX";

/**
 * English MS MARCO MiniLM family (ONNX) — same CE line, depth tradeoff.
 * @see https://huggingface.co/Xenova/ms-marco-MiniLM-L-6-v2
 */
export const LOCAL_RERANK_MODEL_MINILM = "Xenova/ms-marco-MiniLM-L-6-v2";
export const LOCAL_RERANK_MODEL_MINILM_L12 =
  "Xenova/ms-marco-MiniLM-L-12-v2";

export const LOCAL_RERANK_MODELS = {
  base: LOCAL_RERANK_MODEL_BASE,
  "v2-m3": LOCAL_RERANK_MODEL_V2_M3,
  minilm: LOCAL_RERANK_MODEL_MINILM,
  "minilm-l12": LOCAL_RERANK_MODEL_MINILM_L12,
} as const;

export type LocalRerankModelKey = keyof typeof LOCAL_RERANK_MODELS;

/** Devices Transformers.js / onnxruntime-node may accept. */
export type LocalRerankDevice =
  | "auto"
  | "cpu"
  | "gpu"
  | "cuda"
  | "dml"
  | "webgpu"
  | "wasm";

const DEFAULT_MODEL_ID = LOCAL_RERANK_MODEL_BASE;

type LoadedReranker = {
  tokenizer: {
    (
      texts: string[],
      options: {
        text_pair: string[];
        padding: boolean;
        truncation: boolean;
      },
    ): unknown;
  };
  model: (inputs: unknown) => Promise<{
    logits: { data: Float32Array | number[] };
  }>;
  device: string;
};

type ModelSlot = {
  loaded: LoadedReranker | null;
  loadPromise: Promise<LoadedReranker> | null;
  loadError: string | null;
};

const slots = new Map<string, ModelSlot>();

/** Last model that successfully scored — Local Auto may not use getLocalRerankModelId(). */
let lastActive: { modelId: string; device: string } | null = null;

function getSlot(key: string): ModelSlot {
  let slot = slots.get(key);
  if (!slot) {
    slot = { loaded: null, loadPromise: null, loadError: null };
    slots.set(key, slot);
  }
  return slot;
}

function findAnyLoadedDevice(): string | null {
  for (const slot of slots.values()) {
    if (slot.loaded?.device) return slot.loaded.device;
  }
  return null;
}

export function getLocalRerankModelId(): string {
  return (
    process.env.LEDGEINDEX_LOCAL_RERANK_MODEL?.trim() || DEFAULT_MODEL_ID
  );
}

/**
 * Preferred execution device for in-process local rerank.
 * - `LEDGEINDEX_LOCAL_RERANK_DEVICE=auto|cpu|dml|cuda|webgpu|gpu` (default **auto**)
 * - auto on Windows tries DirectML (`dml`) then CPU
 * - auto on Linux tries CUDA then CPU
 */
export function getLocalRerankDevicePreference(
  raw = process.env.LEDGEINDEX_LOCAL_RERANK_DEVICE,
): LocalRerankDevice {
  const value = raw?.trim().toLowerCase();
  if (
    value === "cpu" ||
    value === "gpu" ||
    value === "cuda" ||
    value === "dml" ||
    value === "webgpu" ||
    value === "wasm" ||
    value === "auto"
  ) {
    return value;
  }
  return "auto";
}

/** Ordered device attempts for the current platform / preference. */
export function resolveLocalRerankDeviceCandidates(
  preference = getLocalRerankDevicePreference(),
): string[] {
  if (preference !== "auto") return [preference, "cpu"];

  if (process.platform === "win32") {
    // onnxruntime-node on Windows ships DirectML; WebGPU often unsupported in Node EP list.
    return ["dml", "cpu"];
  }
  if (process.platform === "linux") {
    return ["cuda", "cpu"];
  }
  return ["cpu"];
}

function sigmoid(value: number): number {
  return 1 / (1 + Math.exp(-value));
}

/**
 * Prefer in-process BGE unless an explicit sidecar mode/url is forced.
 * - `LEDGEINDEX_LOCAL_RERANK_MODE=inprocess|sidecar|auto` (default auto)
 * - auto: in-process first, HTTP sidecar fallback
 */
export function preferInProcessLocalRerank(): boolean {
  const mode = process.env.LEDGEINDEX_LOCAL_RERANK_MODE?.trim().toLowerCase();
  if (mode === "sidecar") return false;
  if (mode === "inprocess") return true;
  return true;
}

function slotKey(modelId: string, preference: LocalRerankDevice): string {
  return `${modelId}::${preference}`;
}

async function loadModelOnDevice(
  modelId: string,
  device: string,
): Promise<LoadedReranker> {
  const transformers = await import("@huggingface/transformers");
  transformers.env.allowLocalModels = true;
  transformers.env.useBrowserCache = false;

  const [tokenizer, model] = await Promise.all([
    transformers.AutoTokenizer.from_pretrained(modelId),
    transformers.AutoModelForSequenceClassification.from_pretrained(modelId, {
      dtype: "q8",
      device: device as never,
    }),
  ]);

  return { tokenizer, model, device } as LoadedReranker;
}

async function loadInProcessReranker(modelId: string): Promise<LoadedReranker> {
  const preference = getLocalRerankDevicePreference();
  const key = slotKey(modelId, preference);
  const slot = getSlot(key);
  if (slot.loaded) return slot.loaded;
  if (slot.loadError) throw new Error(slot.loadError);
  if (slot.loadPromise) return slot.loadPromise;

  const candidates = resolveLocalRerankDeviceCandidates(preference);

  slot.loadPromise = (async () => {
    logInfo("Loading in-process local BGE reranker", "LocalBgeRerank", {
      modelId,
      devicePreference: preference,
      candidates,
    });

    let lastError: unknown;
    for (const device of candidates) {
      try {
        const loaded = await loadModelOnDevice(modelId, device);
        slot.loaded = loaded;
        logInfo("In-process local BGE reranker ready", "LocalBgeRerank", {
          modelId,
          device: loaded.device,
        });
        return loaded;
      } catch (error) {
        lastError = error;
        logWarn(
          `Local rerank device "${device}" failed — trying next`,
          "LocalBgeRerank",
          {
            modelId,
            device,
            error: error instanceof Error ? error.message : String(error),
          },
        );
      }
    }

    const message =
      lastError instanceof Error
        ? lastError.message
        : "Failed to load in-process BGE reranker";
    slot.loadError = message;
    slot.loadPromise = null;
    throw lastError instanceof Error ? lastError : new Error(message);
  })().catch((error) => {
    if (slot.loadError == null) {
      slot.loadError =
        error instanceof Error
          ? error.message
          : "Failed to load in-process BGE reranker";
    }
    slot.loadPromise = null;
    throw error instanceof Error ? error : new Error(slot.loadError);
  });

  return slot.loadPromise;
}

/** Score query↔document pairs with an in-process BGE cross-encoder. */
export async function scoreDocumentsInProcess(
  query: string,
  documents: string[],
  modelId: string = getLocalRerankModelId(),
): Promise<number[]> {
  if (documents.length === 0) return [];

  const reranker = await loadInProcessReranker(modelId);
  lastActive = { modelId, device: reranker.device };

  const trimmed = documents.map((document) =>
    String(document ?? "").slice(0, 4000),
  );
  const queries = trimmed.map(() => query);
  const inputs = reranker.tokenizer(queries, {
    text_pair: trimmed,
    padding: true,
    truncation: true,
  });
  const output = await reranker.model(inputs);
  const logits = output.logits.data;

  const scores = Array.from(logits).map((logit) =>
    Math.min(1, Math.max(0, sigmoid(Number(logit)))),
  );

  logVerbose("In-process BGE scored documents", "LocalBgeRerank", {
    documentCount: documents.length,
    modelId,
    device: reranker.device,
  });

  return scores;
}

export function getInProcessLocalRerankStatus(): {
  ready: boolean;
  loading: boolean;
  error: string | null;
  modelId: string;
  devicePreference: LocalRerankDevice;
  device: string | null;
} {
  const preference = getLocalRerankDevicePreference();
  const modelId = lastActive?.modelId ?? getLocalRerankModelId();
  const slot = getSlot(slotKey(modelId, preference));
  const device =
    lastActive?.device ?? slot.loaded?.device ?? findAnyLoadedDevice();

  return {
    ready: device != null || slot.loaded != null,
    loading:
      slot.loadPromise != null && slot.loaded == null && slot.loadError == null,
    error: slot.loadError,
    modelId,
    devicePreference: preference,
    device,
  };
}

/** Warm the default model in the background (optional; first ask will load otherwise). */
export function preloadInProcessLocalRerank(): void {
  if (!preferInProcessLocalRerank()) return;
  void loadInProcessReranker(getLocalRerankModelId()).catch(() => {
    // Status retained in loadError for later asks / health.
  });
}
