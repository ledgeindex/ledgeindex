const PROBE_TIMEOUT_MS = 15_000;

export type PageHeaderProbeResult = {
  url: string;
  ok: boolean;
  status: number | null;
  /** Server returned 304 Not Modified. */
  notModified: boolean;
  etag?: string;
  lastModified?: string;
  reason?: string;
};

function readEtag(response: Response): string | undefined {
  const value = response.headers.get("etag");
  return value?.trim() || undefined;
}

function readLastModified(response: Response): string | undefined {
  const value = response.headers.get("last-modified");
  return value?.trim() || undefined;
}

/**
 * Lightweight HEAD (or conditional GET fallback) probe.
 * Sends If-None-Match / If-Modified-Since when prior values are known.
 */
export async function probePageHeaders(
  url: string,
  userAgent: string,
  options?: {
    etag?: string | null;
    lastModified?: string | null;
    signal?: AbortSignal;
  },
): Promise<PageHeaderProbeResult> {
  const timeout = AbortSignal.timeout(PROBE_TIMEOUT_MS);
  const combined =
    options?.signal != null
      ? AbortSignal.any([options.signal, timeout])
      : timeout;

  const requestHeaders: Record<string, string> = {
    "User-Agent": userAgent,
    Accept: "*/*",
  };
  if (options?.etag) {
    requestHeaders["If-None-Match"] = options.etag;
  }
  if (options?.lastModified) {
    requestHeaders["If-Modified-Since"] = options.lastModified;
  }

  try {
    let response = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      headers: requestHeaders,
      signal: combined,
    });

    if (response.status === 405 || response.status === 501) {
      response = await fetch(url, {
        method: "GET",
        redirect: "follow",
        headers: {
          ...requestHeaders,
          Range: "bytes=0-0",
        },
        signal: combined,
      });
    }

    if (response.status === 304) {
      return {
        url,
        ok: true,
        status: 304,
        notModified: true,
        etag: options?.etag ?? readEtag(response) ?? undefined,
        lastModified:
          options?.lastModified ?? readLastModified(response) ?? undefined,
      };
    }

    if (response.status < 200 || response.status >= 300) {
      return {
        url,
        ok: false,
        status: response.status,
        notModified: false,
        reason: `HTTP ${response.status}`,
      };
    }

    return {
      url,
      ok: true,
      status: response.status,
      notModified: false,
      etag: readEtag(response),
      lastModified: readLastModified(response),
    };
  } catch (error) {
    if (options?.signal?.aborted) {
      return {
        url,
        ok: false,
        status: null,
        notModified: false,
        reason: "Cancelled",
      };
    }
    const message =
      error instanceof Error ? error.message : "Request failed";
    return {
      url,
      ok: false,
      status: null,
      notModified: false,
      reason: `Network error: ${message}`,
    };
  }
}

export function headersIndicateChange(input: {
  storedEtag?: string | null;
  storedLastModified?: string | null;
  etag?: string;
  lastModified?: string;
  notModified: boolean;
  /** True when we had no stored headers and just captured a baseline. */
  baselineCaptured?: boolean;
}): { changed: boolean; baselineCaptured: boolean } {
  if (input.notModified) {
    return { changed: false, baselineCaptured: false };
  }

  const hadStored =
    Boolean(input.storedEtag?.trim()) ||
    Boolean(input.storedLastModified?.trim());

  if (!hadStored) {
    const hasNew =
      Boolean(input.etag?.trim()) || Boolean(input.lastModified?.trim());
    if (hasNew) {
      return { changed: false, baselineCaptured: true };
    }
    return { changed: false, baselineCaptured: false };
  }

  if (
    input.storedEtag &&
    input.etag &&
    input.storedEtag !== input.etag
  ) {
    return { changed: true, baselineCaptured: false };
  }

  if (
    input.storedLastModified &&
    input.lastModified &&
    input.storedLastModified !== input.lastModified
  ) {
    return { changed: true, baselineCaptured: false };
  }

  return { changed: false, baselineCaptured: false };
}
