/**
 * Cheap gate: skip LLM when the page has no grounded example signals.
 * Looks for fenced/indented code and setup/usage/example headings.
 */

const FENCE_RE = /```[\w+#.-]*/;
const INDENTED_CODE_RE = /(?:^|\n)(?: {4}|\t).+\n(?:(?: {4}|\t).+\n){1,}/;
const EXAMPLE_HEADING_RE =
  /^#{1,6}\s+.*\b(example|examples|usage|quick\s*start|quickstart|getting\s+started|setup|install(?:ation)?|configuration|config|how\s+to|tutorial|walkthrough)\b/im;

export type ExampleCandidateSignals = {
  hasFencedCode: boolean;
  hasIndentedCode: boolean;
  hasExampleHeading: boolean;
};

export function detectExampleCandidateSignals(
  markdown: string,
): ExampleCandidateSignals {
  const text = markdown ?? "";
  return {
    hasFencedCode: FENCE_RE.test(text),
    hasIndentedCode: INDENTED_CODE_RE.test(text),
    hasExampleHeading: EXAMPLE_HEADING_RE.test(text),
  };
}

export function hasExampleCandidates(markdown: string): boolean {
  const signals = detectExampleCandidateSignals(markdown);
  return (
    signals.hasFencedCode ||
    signals.hasIndentedCode ||
    signals.hasExampleHeading
  );
}

/** Heuristic skip when we never call the enrich LLM. */
export type HeuristicEnrichSkip = {
  reason: "empty_page" | "info_only";
  detail: string;
};

export function classifyHeuristicEnrichSkip(
  markdown: string,
): HeuristicEnrichSkip | null {
  const text = markdown?.trim() ?? "";
  if (!text) {
    return {
      reason: "empty_page",
      detail: "Page has no markdown content after extract.",
    };
  }
  if (hasExampleCandidates(text)) return null;

  return {
    reason: "info_only",
    detail:
      "Info/overview page — no code fences, indented code, or example/setup headings. LLM was not called.",
  };
}
