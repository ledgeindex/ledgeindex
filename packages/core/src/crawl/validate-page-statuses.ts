import { mapWithConcurrency } from "../lib/map-with-concurrency.js";
import type { DiscoveredUrl, SkippedUrl } from "./discover.js";

const DEFAULT_CONCURRENCY = 8;
const PROBE_TIMEOUT_MS = 15_000;

export const HTTP_STATUS_SKIP_PREFIX = "HTTP ";

export function isHttpStatusSkip(reason: string): boolean {
  return (
    reason.startsWith(HTTP_STATUS_SKIP_PREFIX) ||
    reason.startsWith("Request failed") ||
    reason.startsWith("Network error")
  );
}

export function httpStatusSkipReason(status: number): string {
  return `${HTTP_STATUS_SKIP_PREFIX}${status}`;
}

export type ProbePageStatusResult = {
  url: string;
  ok: boolean;
  status: number | null;
  reason?: string;
};

/**
 * HEAD (or GET fallback) probe — no AI. Only final 2xx responses are kept;
 * 404, 429, 5xx, leftover 3xx, etc. are marked as error pages.
 */
export async function probePageStatus(
  url: string,
  userAgent: string,
  signal?: AbortSignal,
): Promise<ProbePageStatusResult> {
  const timeout = AbortSignal.timeout(PROBE_TIMEOUT_MS);
  const combined =
    signal != null ? AbortSignal.any([signal, timeout]) : timeout;

  try {
    let response = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      headers: { "User-Agent": userAgent, Accept: "*/*" },
      signal: combined,
    });

    // Some docs hosts reject HEAD; fall back to a cheap GET.
    if (response.status === 405 || response.status === 501) {
      response = await fetch(url, {
        method: "GET",
        redirect: "follow",
        headers: {
          "User-Agent": userAgent,
          Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
          Range: "bytes=0-0",
        },
        signal: combined,
      });
    }

    // Only successful responses stay in the crawl list (200–299 after redirects).
    // 3xx leftovers, 4xx (incl. 404/429), 5xx, and odd 1xx are all dropped.
    if (response.status < 200 || response.status >= 300) {
      return {
        url,
        ok: false,
        status: response.status,
        reason: httpStatusSkipReason(response.status),
      };
    }

    return { url, ok: true, status: response.status };
  } catch (error) {
    if (signal?.aborted) {
      return { url, ok: false, status: null, reason: "Cancelled" };
    }
    const message =
      error instanceof Error ? error.message : "Request failed";
    return {
      url,
      ok: false,
      status: null,
      reason: `Network error: ${message}`,
    };
  }
}

export type FilterUrlsByHttpStatusOptions = {
  userAgent: string;
  /** Skip probing URLs already confirmed OK during the link crawl. */
  confirmedOkUrls?: ReadonlySet<string>;
  concurrency?: number;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
};

/**
 * Always-on error-page cleaner: keep only 2xx URLs; drop everything else
 * (404, 429, 5xx, network failures, …) before review / auto-exclude heuristics.
 */
export async function filterUrlsByHttpStatus(
  urls: DiscoveredUrl[],
  options: FilterUrlsByHttpStatusOptions,
): Promise<{
  urls: DiscoveredUrl[];
  skipped: SkippedUrl[];
  httpStatusFiltered: number;
}> {
  const confirmed = options.confirmedOkUrls;
  const toProbe = confirmed
    ? urls.filter((item) => !confirmed.has(item.url))
    : urls;
  const alreadyOk = confirmed
    ? urls.filter((item) => confirmed.has(item.url))
    : [];

  if (toProbe.length === 0) {
    options.onProgress?.(0, 0);
    return { urls, skipped: [], httpStatusFiltered: 0 };
  }

  const concurrency = Math.max(
    1,
    options.concurrency ?? DEFAULT_CONCURRENCY,
  );

  const results = await mapWithConcurrency(
    toProbe,
    concurrency,
    (item) => probePageStatus(item.url, options.userAgent, options.signal),
    {
      onItemComplete: (done, total) => options.onProgress?.(done, total),
      shouldAbort: () => Boolean(options.signal?.aborted),
      abortError: () => {
        const err = new Error("aborted");
        err.name = "AbortError";
        return err;
      },
    },
  );

  const skipped: SkippedUrl[] = [];
  const probedOk: DiscoveredUrl[] = [];

  for (let i = 0; i < toProbe.length; i += 1) {
    const item = toProbe[i]!;
    const result = results[i]!;
    if (result.ok) {
      probedOk.push(item);
    } else {
      skipped.push({
        url: item.url,
        reason: result.reason ?? httpStatusSkipReason(result.status ?? 0),
      });
    }
  }

  return {
    urls: [...alreadyOk, ...probedOk],
    skipped,
    httpStatusFiltered: skipped.length,
  };
}
