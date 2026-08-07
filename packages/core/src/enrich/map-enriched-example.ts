import { buildExampleEmbedText } from "./build-embed-text.js";
import { normalizeApiResponseMeta } from "./api-response-meta.js";
import { normalizeExampleLanguage } from "./normalize-example-language.js";
import { resolveExampleSection } from "./resolve-example-section.js";
import type { EnrichedExample, EnrichLlmOutput } from "./schemas.js";

type ExtractedExample = EnrichLlmOutput["extracted_examples"][number];

export function sanitizeExampleBody(body: string): string {
  return body
    .replace(/\r\n/g, "\n")
    .replace(/\bglobal\.export\b/g, "export")
    .replace(/\bglobal\.import\b/g, "import")
    .trim();
}

export function mapExtractedExampleToEnriched(input: {
  ex: ExtractedExample;
  exampleIndex: number;
  pageTitle: string;
  pageSummary: string;
  sectionResolveMarkdown: string;
  fallbackPageTitle?: string;
}): EnrichedExample {
  const title = input.ex.title.trim();
  const description = input.ex.description.trim();
  const body = sanitizeExampleBody(input.ex.body);
  const section = resolveExampleSection({
    markdown: input.sectionResolveMarkdown,
    body,
    llmSection: input.ex.section,
    pageTitle: input.fallbackPageTitle ?? input.pageTitle,
  });

  const apiResponse = normalizeApiResponseMeta({
    kind: input.ex.kind,
    title,
    body,
    fromLlm: input.ex.apiResponse ?? null,
  });

  let language = normalizeExampleLanguage(input.ex.language);
  if (
    input.ex.kind === "api_response" &&
    !language &&
    (apiResponse?.contentType === "json" || body.trim().startsWith("{"))
  ) {
    language = "json";
  }

  return {
    kind: input.ex.kind,
    title,
    description,
    language,
    body,
    section,
    exampleIndex: input.exampleIndex,
    ...(apiResponse ? { apiResponse } : {}),
    embedText: buildExampleEmbedText({
      pageTitle: input.pageTitle,
      pageSummary: input.pageSummary,
      kind: input.ex.kind,
      title,
      description,
      body,
      section,
      language,
      apiResponse,
    }),
    confidence: "extracted",
  };
}
