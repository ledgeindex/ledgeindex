import { AsyncLocalStorage } from "node:async_hooks";
import type { RerankBackend } from "./rerank-backend.js";
import {
  DEFAULT_RETRIEVAL_STRICTNESS,
  isRetrievalStrictness,
  resolveRetrievalSettings,
  type ResolvedRetrievalSettings,
  type RetrievalStrictness,
} from "./retrieval-strictness.js";

export type SourceScope = "personal" | "global";
export type SourceHosting = "local" | "cloud";

type RetrievalRequestContext = {
  backend?: RerankBackend;
  sourceScope?: SourceScope;
  sourceHosting?: SourceHosting;
  retrievalStrictness?: RetrievalStrictness;
  relevanceThreshold?: number | null;
  includeWeakEvidence?: boolean;
};

const storage = new AsyncLocalStorage<RetrievalRequestContext>();

export function getRequestRerankBackend(): RerankBackend | undefined {
  return storage.getStore()?.backend;
}

export function getRequestSourceScope(): SourceScope | undefined {
  return storage.getStore()?.sourceScope;
}

export function getRequestSourceHosting(): SourceHosting | undefined {
  return storage.getStore()?.sourceHosting;
}

/** Cloud-hosted sources (incl. personal-on-cloud) → Gemini + pgvector + Cohere Auto. */
export function preferCloudRetrieval(): boolean {
  const hosting = getRequestSourceHosting();
  if (hosting === "cloud") return true;
  if (hosting === "local") return false;
  return getRequestSourceScope() === "global";
}

export function setRequestRerankBackend(backend: RerankBackend): void {
  const store = storage.getStore();
  if (store) {
    store.backend = backend;
    return;
  }
  storage.enterWith({ backend });
}

export function setRequestSourceScope(scope: SourceScope): void {
  const store = storage.getStore();
  if (store) {
    store.sourceScope = scope;
    return;
  }
  storage.enterWith({ sourceScope: scope });
}

export function setRequestSourceHosting(hosting: SourceHosting): void {
  const store = storage.getStore();
  if (store) {
    store.sourceHosting = hosting;
    return;
  }
  storage.enterWith({ sourceHosting: hosting });
}

export function getResolvedRetrievalSettings(): ResolvedRetrievalSettings {
  const store = storage.getStore();
  return resolveRetrievalSettings({
    strictness: store?.retrievalStrictness,
    relevanceThreshold: store?.relevanceThreshold,
    includeWeakEvidence: store?.includeWeakEvidence,
  });
}

export function setRequestRetrievalStrictness(strictness: RetrievalStrictness): void {
  const store = storage.getStore();
  if (store) {
    store.retrievalStrictness = strictness;
    return;
  }
  storage.enterWith({ retrievalStrictness: strictness });
}

export function setRequestRelevanceThreshold(threshold: number | null): void {
  const store = storage.getStore();
  if (store) {
    store.relevanceThreshold = threshold;
    return;
  }
  storage.enterWith({ relevanceThreshold: threshold });
}

export function setRequestIncludeWeakEvidence(include: boolean): void {
  const store = storage.getStore();
  if (store) {
    store.includeWeakEvidence = include;
    return;
  }
  storage.enterWith({ includeWeakEvidence: include });
}

export function applyRetrievalSettingsToStore(
  settings: ResolvedRetrievalSettings,
): void {
  setRequestRetrievalStrictness(settings.strictness);
  setRequestRelevanceThreshold(settings.relevanceThreshold);
  setRequestIncludeWeakEvidence(settings.includeWeakEvidence);
}

export function readRetrievalSettingsFromRequestContext(
  requestContext?: { get?: (key: string) => unknown },
): ResolvedRetrievalSettings {
  const strictness = requestContext?.get?.("retrieval_strictness");
  const threshold = requestContext?.get?.("relevance_threshold");
  const includeWeak = requestContext?.get?.("include_weak_evidence");

  const fromCtx = resolveRetrievalSettings({
    strictness: isRetrievalStrictness(strictness) ? strictness : undefined,
    relevanceThreshold:
      typeof threshold === "number" || threshold === null
        ? (threshold as number | null)
        : undefined,
    includeWeakEvidence:
      typeof includeWeak === "boolean" ? includeWeak : undefined,
  });

  const store = storage.getStore();
  if (!store?.retrievalStrictness && !store?.relevanceThreshold && store?.includeWeakEvidence === undefined) {
    return fromCtx;
  }

  return resolveRetrievalSettings({
    strictness: store?.retrievalStrictness ?? fromCtx.strictness,
    relevanceThreshold:
      store?.relevanceThreshold !== undefined
        ? store.relevanceThreshold
        : fromCtx.relevanceThreshold,
    includeWeakEvidence:
      store?.includeWeakEvidence ?? fromCtx.includeWeakEvidence,
  });
}

/** Run `fn` with per-request retrieval overrides (rerank + source scope/hosting). */
export function runWithRetrievalContext<T>(
  input: {
    backend?: RerankBackend;
    sourceScope?: SourceScope;
    sourceHosting?: SourceHosting;
    retrievalStrictness?: RetrievalStrictness;
    relevanceThreshold?: number | null;
    includeWeakEvidence?: boolean;
  },
  fn: () => Promise<T>
): Promise<T> {
  const current = storage.getStore() ?? {};
  const mergedSettings = resolveRetrievalSettings({
    strictness: input.retrievalStrictness ?? current.retrievalStrictness,
    relevanceThreshold:
      input.relevanceThreshold !== undefined
        ? input.relevanceThreshold
        : current.relevanceThreshold,
    includeWeakEvidence: input.includeWeakEvidence ?? current.includeWeakEvidence,
  });
  return storage.run(
    {
      backend: input.backend ?? current.backend,
      sourceScope: input.sourceScope ?? current.sourceScope,
      sourceHosting: input.sourceHosting ?? current.sourceHosting,
      retrievalStrictness: mergedSettings.strictness,
      relevanceThreshold: mergedSettings.relevanceThreshold,
      includeWeakEvidence: mergedSettings.includeWeakEvidence,
    },
    fn
  );
}

export {
  DEFAULT_RETRIEVAL_STRICTNESS,
  isRetrievalStrictness,
  resolveRetrievalSettings,
  type RetrievalStrictness,
  type ResolvedRetrievalSettings,
} from "./retrieval-strictness.js";

/** @deprecated Prefer runWithRetrievalContext — kept for callers. */
export function runWithRerankBackend<T>(
  backend: RerankBackend | undefined,
  fn: () => Promise<T>
): Promise<T> {
  if (!backend) return fn();
  return runWithRetrievalContext({ backend }, fn);
}

export const REQUEST_RERANK_BACKENDS = [
  "cohere",
  "cohere-auto",
  "cohere-v4-fast",
  "local-v2",
  "local-auto",
  "local-mini",
  "local-mini-l12",
  "vector",
] as const satisfies readonly RerankBackend[];

export function isRequestRerankBackend(value: unknown): value is RerankBackend {
  return (
    value === "cohere" ||
    value === "cohere-auto" ||
    value === "cohere-v4-fast" ||
    value === "local-v2" ||
    value === "local-auto" ||
    value === "local-mini" ||
    value === "local-mini-l12" ||
    value === "vector" ||
    value === "llm-batch" ||
    value === "cohere-mastra"
  );
}

export function isSourceScope(value: unknown): value is SourceScope {
  return value === "personal" || value === "global";
}

export function isSourceHosting(value: unknown): value is SourceHosting {
  return value === "local" || value === "cloud";
}
