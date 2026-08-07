import { z } from "zod";

const domainRatingFreeSchema = z.object({
  domain_rating: z.object({
    domain_rating: z.number(),
    license: z.string().optional(),
    warning: z.string().nullable().optional(),
  }),
});

export type AhrefsDomainRatingResult = {
  target: string;
  domainRating: number;
  license?: string;
  warning?: string | null;
};

export type FetchDomainRatingOptions = {
  apiKey?: string;
};

function normalizeTarget(input: string): string {
  const trimmed = input.trim();
  try {
    if (trimmed.includes("://")) {
      return new URL(trimmed).hostname.replace(/^www\./, "");
    }
  } catch {
    /* fall through */
  }
  return trimmed.replace(/^www\./, "").toLowerCase();
}

export async function fetchDomainRatingFree(
  target: string,
  options?: FetchDomainRatingOptions,
): Promise<AhrefsDomainRatingResult> {
  const normalized = normalizeTarget(target);
  const url = new URL("https://api.ahrefs.com/v3/public/domain-rating-free");
  url.searchParams.set("target", normalized);
  url.searchParams.set("output", "json");

  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  const apiKey = options?.apiKey?.trim();
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const response = await fetch(url.toString(), { method: "GET", headers });
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Ahrefs HTTP ${response.status}: ${text.slice(0, 400)}`);
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Ahrefs non-JSON: ${text.slice(0, 400)}`);
  }

  const parsed = domainRatingFreeSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`Ahrefs unexpected shape: ${text.slice(0, 400)}`);
  }

  return {
    target: normalized,
    domainRating: parsed.data.domain_rating.domain_rating,
    license: parsed.data.domain_rating.license,
    warning: parsed.data.domain_rating.warning,
  };
}

export async function fetchDomainRatingsFree(
  targets: string[],
  options?: FetchDomainRatingOptions & { delayMs?: number },
): Promise<AhrefsDomainRatingResult[]> {
  const unique = [...new Set(targets.map(normalizeTarget).filter(Boolean))];
  const results: AhrefsDomainRatingResult[] = [];
  const delayMs = options?.delayMs ?? 350;

  for (let i = 0; i < unique.length; i++) {
    if (i > 0 && delayMs > 0) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
    results.push(await fetchDomainRatingFree(unique[i]!, options));
  }

  return results;
}

export { normalizeTarget as normalizeAhrefsTarget };
