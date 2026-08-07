export type KweCpc = {
  currency: string;
  value: string;
};

export type KweTrendPoint = {
  month: string;
  year: number;
  value: number;
};

export type DomainKeywordData = {
  keyword: string;
  vol: number;
  cpc: KweCpc;
  competition: number;
  position?: number;
  trend?: KweTrendPoint[];
};

export type KeywordsEverywhereResponse = {
  data: DomainKeywordData[];
  credits: number;
  credits_consumed: number;
  time: number;
};

export type GetDomainKeywordsOptions = {
  country?: string;
  currency?: string;
};

export async function getDomainKeywords(
  domain: string,
  apiKey: string,
  options?: GetDomainKeywordsOptions,
): Promise<KeywordsEverywhereResponse> {
  const endpoint = "https://api.keywordseverywhere.com/v1/get_domain_keywords";
  const country = (options?.country ?? "us").trim().toLowerCase();
  const currency = (options?.currency ?? "usd").trim().toLowerCase();

  const body = new URLSearchParams({
    domain: domain.replace(/^www\./, ""),
    country,
    currency,
  });

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  const text = await response.text();
  let result: KeywordsEverywhereResponse & { message?: string; error?: string };
  try {
    result = JSON.parse(text) as KeywordsEverywhereResponse & {
      message?: string;
      error?: string;
    };
  } catch {
    throw new Error(`Keywords Everywhere non-JSON (${response.status}): ${text.slice(0, 400)}`);
  }

  if (!response.ok) {
    if (response.status === 402) {
      throw new Error(
        "402 Insufficient Credits — API key is valid but your Keywords Everywhere balance is empty. Top up credits in the extension/dashboard, then retry.",
      );
    }
    throw new Error(
      `Keywords Everywhere HTTP ${response.status}: ${result.message ?? result.error ?? text.slice(0, 300)}`,
    );
  }

  return result;
}
