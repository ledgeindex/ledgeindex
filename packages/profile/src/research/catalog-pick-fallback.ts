import type { ResearchLens } from "./research-lenses.js";
import type { SiteCatalogPage } from "./crawl-catalog.js";

export function normalizeCatalogUrl(url: string): string {
  try {
    const parsed = new URL(url.trim());
    parsed.hash = "";
    const path = parsed.pathname.replace(/\/+$/, "") || "/";
    return `${parsed.origin}${path}`;
  } catch {
    return url.trim();
  }
}

/** Homepage / start URL row in the crawl catalog. */
export function findCatalogRootPage(
  catalog: SiteCatalogPage[],
  rootUrl: string,
): SiteCatalogPage | null {
  const target = normalizeCatalogUrl(rootUrl);
  const exact = catalog.find((p) => normalizeCatalogUrl(p.url) === target);
  if (exact) return exact;

  try {
    const origin = new URL(rootUrl).origin;
    const onOrigin = catalog.filter((p) => {
      try {
        return new URL(p.url).origin === origin;
      } catch {
        return false;
      }
    });
    if (onOrigin.length === 0) return null;
    onOrigin.sort(
      (a, b) =>
        new URL(a.url).pathname.replace(/\/+$/, "").length -
        new URL(b.url).pathname.replace(/\/+$/, "").length,
    );
    return onOrigin[0] ?? null;
  } catch {
    return catalog[0] ?? null;
  }
}

const LENS_PATH_HINTS: Record<ResearchLens, RegExp[]> = {
  identity: [/\/$/, /about/i, /company/i, /mission/i, /who-we/i, /solutions?/i],
  docs_identity: [
    /\/docs\/?$/i,
    /documentation/i,
    /reference/i,
    /guides?/i,
    /concepts?/i,
    /tutorials?/i,
    /getting[-]?started/i,
    /overview/i,
    /api/i,
    /changelog/i,
    /\/$/,
  ],
  capabilities: [
    /product/i,
    /platform/i,
    /features?/i,
    /solutions?/i,
    /capabilities/i,
  ],
  pricing: [/pricing/i, /plans?/i, /billing/i, /subscribe/i, /buy/i],
  business_model: [
    /pricing/i,
    /plans?/i,
    /billing/i,
    /enterprise/i,
    /demo/i,
    /trial/i,
    /try/i,
    /get[-]?started/i,
    /signup/i,
    /onboard/i,
    /subscribe/i,
    /marketplace/i,
    /partners?/i,
    /customers?/i,
    /about/i,
    /platform/i,
    /product/i,
    /solutions?/i,
    /deploy/i,
    /connect/i,
    /\/$/,
  ],
  integrations: [/integrations?/i, /connect/i, /marketplace/i, /partners?/i],
  trust: [/security/i, /trust/i, /compliance/i, /privacy/i, /legal/i],
  gtm: [/pricing/i, /demo/i, /trial/i, /signup/i, /contact/i, /get-started/i],
  ai_and_dev_experience: [
    /docs/i,
    /developers?/i,
    /api/i,
    /sdk/i,
    /mcp/i,
    /reference/i,
  ],
  basic_usage: [
    /get[-]?started/i,
    /quickstart/i,
    /install/i,
    /hello[-]?world/i,
    /intro/i,
    /tutorial/i,
    /first[-]?steps/i,
    /\/docs\/?$/i,
  ],
  main_use_cases: [
    /use[-]?cases?/i,
    /guides?/i,
    /tutorials?/i,
    /examples?/i,
    /recipes?/i,
    /how[-]?to/i,
    /solutions?/i,
    /scenarios?/i,
  ],
  business_usage: [
    /solutions?/i,
    /customers?/i,
    /case[-]?stud/i,
    /industr/i,
    /who[-]?we/i,
    /built[-]?with/i,
    /used[-]?for/i,
    /stories?/i,
    /success/i,
    /\/$/,
  ],
  package_primitives_usage: [
    /intro/i,
    /first[-]?steps/i,
    /basics?/i,
    /concepts?/i,
    /api/i,
    /reference/i,
    /overview/i,
    /\/docs\/?$/i,
    /getting[-]?started/i,
  ],
  package_usage_examples: [
    /examples?/i,
    /guides?/i,
    /tutorials?/i,
    /recipes?/i,
    /templates?/i,
    /cookbook/i,
    /quickstart/i,
    /samples?/i,
    /how[-]?to/i,
  ],
  content_seo_strategy: [
    /blog/i,
    /resources?/i,
    /learn/i,
    /content/i,
    /guides?/i,
    /hub/i,
    /compare/i,
    /vs[-/]/i,
    /alternatives?/i,
    /customers?/i,
    /stories?/i,
    /changelog/i,
    /updates?/i,
    /faq/i,
    /glossary/i,
    /seo/i,
    /\/docs\/?$/i,
    /\/$/,
  ],
};

/** Lenses where the marketing homepage often holds the only signal. */
const LENS_INCLUDE_ROOT_WHEN_EMPTY: ReadonlySet<ResearchLens> = new Set([
  "identity",
  "docs_identity",
  "pricing",
  "business_model",
  "gtm",
  "capabilities",
  "basic_usage",
  "main_use_cases",
  "business_usage",
  "package_primitives_usage",
  "package_usage_examples",
  "content_seo_strategy",
]);

function pagesMatchingHints(
  catalog: SiteCatalogPage[],
  lens: ResearchLens,
  max: number,
): SiteCatalogPage[] {
  const hints = LENS_PATH_HINTS[lens];
  const out: SiteCatalogPage[] = [];
  const seen = new Set<string>();
  for (const page of catalog) {
    let path = page.url;
    try {
      const parsed = new URL(page.url);
      path = `${parsed.pathname}${parsed.search} ${page.title}`;
    } catch {
      path = `${page.url} ${page.title}`;
    }
    if (!hints.some((re) => re.test(path) || re.test(page.url))) continue;
    if (seen.has(page.url)) continue;
    seen.add(page.url);
    out.push(page);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * When the LLM picker returns nothing, use path heuristics and (for some lenses) the site root.
 */
export function applyCatalogPickFallback(input: {
  lens: ResearchLens;
  catalog: SiteCatalogPage[];
  rootUrl: string;
  selected: SiteCatalogPage[];
  maxPages?: number;
}): { selected: SiteCatalogPage[]; usedFallback: boolean; fallbackSummary: string } {
  if (input.selected.length > 0) {
    return {
      selected: input.selected,
      usedFallback: false,
      fallbackSummary: "",
    };
  }

  const max = input.maxPages ?? 6;
  const merged = new Map<string, SiteCatalogPage>();
  const root = findCatalogRootPage(input.catalog, input.rootUrl);

  for (const page of pagesMatchingHints(input.catalog, input.lens, max)) {
    merged.set(page.url, page);
  }

  if (LENS_INCLUDE_ROOT_WHEN_EMPTY.has(input.lens) && root) {
    merged.set(root.url, root);
  }

  if (merged.size === 0 && root) {
    merged.set(root.url, root);
  }

  if (merged.size === 0 && input.catalog[0]) {
    merged.set(input.catalog[0].url, input.catalog[0]);
  }

  const selected = [...merged.values()].slice(0, max);
  if (selected.length === 0) {
    return {
      selected: [],
      usedFallback: true,
      fallbackSummary: "Picker returned no URLs; no catalog fallback matched.",
    };
  }

  const parts = ["LLM picker returned no URLs; used catalog fallback."];
  if (root && selected.some((p) => p.url === root.url)) {
    parts.push(
      "Included site root/home — pricing and positioning often appear there.",
    );
  }
  return {
    selected,
    usedFallback: true,
    fallbackSummary: parts.join(" "),
  };
}
