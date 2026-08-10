import { RequestContext } from "@mastra/core/request-context";

type CtxLike =
  | RequestContext
  | Record<string, unknown>
  | { get?: (key: string) => unknown; set?: (key: string, value: unknown) => void }
  | null
  | undefined;

function isRequestContext(value: unknown): value is RequestContext {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as RequestContext).get === "function" &&
    typeof (value as RequestContext).set === "function"
  );
}

function entriesFrom(value: CtxLike): Array<[string, unknown]> {
  if (!value || typeof value !== "object") return [];
  if (isRequestContext(value)) {
    return [...value.entries()] as Array<[string, unknown]>;
  }
  if (typeof (value as { get?: unknown }).get === "function") {
    return [];
  }
  return Object.entries(value as Record<string, unknown>);
}

/**
 * Mastra chat middleware often installs an empty RequestContext that would
 * otherwise shadow the client body (`model_id`, `rerank_backend`, …).
 * Merge: middleware values win on conflict; body fills everything else.
 */
export function mergeChatRequestContext(input: {
  middleware?: CtxLike;
  body?: CtxLike;
}): RequestContext {
  const merged = new RequestContext();

  for (const [key, value] of entriesFrom(input.body)) {
    if (value !== undefined) merged.set(key, value);
  }
  for (const [key, value] of entriesFrom(input.middleware)) {
    if (value !== undefined) merged.set(key, value);
  }

  return merged;
}

/** Read a context value from RequestContext or a plain object. */
export function readChatContextValue(
  requestContext: CtxLike,
  key: string,
): unknown {
  if (!requestContext || typeof requestContext !== "object") return undefined;
  if (typeof (requestContext as { get?: unknown }).get === "function") {
    return (requestContext as { get: (k: string) => unknown }).get(key);
  }
  return (requestContext as Record<string, unknown>)[key];
}
