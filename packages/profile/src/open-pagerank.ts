export type PageRankResultItem = {
  domain: string;
  found?: boolean;
  open_page_rank: number;
  rank: number | string;
  referring_domains?: number;
};

type OpenPageRankAPIResponse = {
  results?: PageRankResultItem[];
  response?: PageRankResultItem[];
  as_of?: string;
  count?: number;
  invalid?: string[];
  error?: string | { type?: string; message?: string };
};

export type BulkPageRankResult = {
  as_of?: string;
  items: PageRankResultItem[];
  invalid: string[];
};

export function normalizeDomain(input: string): string {
  const trimmed = input.trim().toLowerCase();
  try {
    if (trimmed.includes("://")) {
      return new URL(trimmed).hostname.replace(/^www\./, "");
    }
  } catch {
    /* fall through */
  }
  return trimmed.replace(/^www\./, "");
}

export function domainFromUrl(url: string): string | null {
  try {
    return normalizeDomain(new URL(url).hostname);
  } catch {
    return null;
  }
}

function extractResults(data: OpenPageRankAPIResponse): PageRankResultItem[] {
  if (Array.isArray(data.results) && data.results.length > 0) {
    return data.results;
  }
  if (Array.isArray(data.response) && data.response.length > 0) {
    return data.response;
  }
  return [];
}

export async function fetchBulkPageRank(
  domains: string[],
  apiKey: string,
): Promise<BulkPageRankResult> {
  const unique = [...new Set(domains.map(normalizeDomain).filter(Boolean))];
  if (unique.length === 0) {
    return { items: [], invalid: [] };
  }
  if (unique.length > 100) {
    throw new Error("OpenPageRank bulk API allows at most 100 domains per request");
  }

  const endpoint = "https://openpagerank.keywordseverywhere.com/v1/domains/bulk";
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      domains: unique,
      include_history: false,
    }),
  });

  const text = await response.text();
  let data: OpenPageRankAPIResponse;
  try {
    data = JSON.parse(text) as OpenPageRankAPIResponse;
  } catch {
    throw new Error(`OpenPageRank non-JSON (${response.status}): ${text.slice(0, 400)}`);
  }

  if (!response.ok) {
    const err = data.error;
    const detail =
      typeof err === "string"
        ? err
        : err && typeof err === "object" && "message" in err
          ? String((err as { message?: string }).message)
          : JSON.stringify(data);
    throw new Error(`OpenPageRank HTTP ${response.status}: ${detail}`);
  }

  return {
    as_of: data.as_of,
    items: extractResults(data),
    invalid: data.invalid ?? [],
  };
}
