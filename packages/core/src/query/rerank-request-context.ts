import { AsyncLocalStorage } from "node:async_hooks";
import type { RerankBackend } from "./rerank-backend.js";

export type SourceScope = "personal" | "global";
export type SourceHosting = "local" | "cloud";

type RetrievalRequestContext = {
  backend?: RerankBackend;
  sourceScope?: SourceScope;
  sourceHosting?: SourceHosting;
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

/** Run `fn` with per-request retrieval overrides (rerank + source scope/hosting). */
export function runWithRetrievalContext<T>(
  input: {
    backend?: RerankBackend;
    sourceScope?: SourceScope;
    sourceHosting?: SourceHosting;
  },
  fn: () => Promise<T>,
): Promise<T> {
  const current = storage.getStore() ?? {};
  return storage.run(
    {
      backend: input.backend ?? current.backend,
      sourceScope: input.sourceScope ?? current.sourceScope,
      sourceHosting: input.sourceHosting ?? current.sourceHosting,
    },
    fn,
  );
}

/** @deprecated Prefer runWithRetrievalContext — kept for callers. */
export function runWithRerankBackend<T>(
  backend: RerankBackend | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  if (!backend) return fn();
  return runWithRetrievalContext({ backend }, fn);
}

export const REQUEST_RERANK_BACKENDS = [
  "cohere",
  "cohere-auto",
  "cohere-v4-fast",
  "local",
  "local-v2",
  "local-auto",
  "local-mini",
  "local-mini-l12",
  "vector",
] as const satisfies readonly RerankBackend[];

export function isRequestRerankBackend(
  value: unknown,
): value is RerankBackend {
  return (
    value === "cohere" ||
    value === "cohere-auto" ||
    value === "cohere-v4-fast" ||
    value === "local" ||
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
