/**
 * Map items with a fixed concurrency limit (worker-pool style).
 * On first failure / cancel, stops claiming new items (in-flight work may finish).
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
  options?: {
    onItemComplete?: (completed: number, total: number) => void;
    /** When true, stop claiming new items and reject once in-flight work settles. */
    shouldAbort?: () => boolean;
    /** Error thrown when shouldAbort() is true (defaults to Error("aborted")). */
    abortError?: () => unknown;
  },
): Promise<R[]> {
  if (items.length === 0) return [];

  const limit = Math.max(1, Math.min(concurrency, items.length));
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  let completed = 0;
  let stopError: unknown;

  const noteStop = (error: unknown) => {
    if (stopError === undefined) stopError = error;
  };

  async function worker() {
    while (true) {
      if (stopError !== undefined) return;

      if (options?.shouldAbort?.()) {
        noteStop(options.abortError?.() ?? new Error("aborted"));
        return;
      }

      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;

      try {
        results[index] = await fn(items[index]!, index);
        if (stopError !== undefined) return;
        completed += 1;
        options?.onItemComplete?.(completed, items.length);
      } catch (error) {
        noteStop(error);
        return;
      }
    }
  }

  await Promise.all(Array.from({ length: limit }, () => worker()));

  if (stopError !== undefined) {
    throw stopError;
  }

  return results;
}
