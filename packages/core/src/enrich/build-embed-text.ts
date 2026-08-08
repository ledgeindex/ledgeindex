import type { ExampleKind } from "./schemas.js";
import type { ApiResponseMeta } from "./api-response-meta.js";
import { formatApiResponseMetaLine } from "./api-response-meta.js";

export function buildExampleEmbedText(input: {
  pageTitle: string;
  pageSummary: string;
  kind: ExampleKind;
  title: string;
  description: string;
  body: string;
  section: string;
  language?: string | null;
  apiResponse?: ApiResponseMeta | null;
}): string {
  const language =
    input.language && input.language.trim().length > 0
      ? ` | Language: ${input.language.trim()}`
      : "";

  const apiLine = input.apiResponse
    ? ` | ${formatApiResponseMetaLine(input.apiResponse)}`
    : "";

  return [
    `Page: ${input.pageTitle.trim() || "Untitled"}`,
    `Section: ${input.section.trim() || "General"}`,
    `Kind: ${input.kind}${language}${apiLine}`,
    `Topic: ${input.title.trim()}`,
    `Summary: ${input.description.trim()}`,
    `Page context: ${input.pageSummary.trim()}`,
    `Example:\n${input.body.trim()}`,
  ].join(" | ");
}
