import type { EnrichPageResult, EnrichedExample } from "./schemas.js";

function normalizeBodyKey(body: string): string {
  return body.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Merge per-section enrich results into one page result.
 * Dedupes examples by normalized body; keeps first non-empty summary.
 */
export function mergeSectionEnrichResults(input: {
  sectionResults: EnrichPageResult[];
  /** Size metadata from the full page. */
  markdownChars: number;
  estimatedTokens: number;
  contextTokenLimit?: number;
  sectionCount: number;
  sectionsWithCandidates: number;
}): EnrichPageResult {
  const meta = {
    markdownChars: input.markdownChars,
    estimatedTokens: input.estimatedTokens,
    enrichPassCount: Math.max(1, input.sectionsWithCandidates),
    ...(input.contextTokenLimit
      ? { contextTokenLimit: input.contextTokenLimit }
      : {}),
  };

  const enriched = input.sectionResults.filter(
    (result): result is Extract<EnrichPageResult, { status: "enriched" }> =>
      result.status === "enriched",
  );

  const examples: EnrichedExample[] = [];
  const seenBodies = new Set<string>();
  const summaries: string[] = [];

  for (const result of enriched) {
    const summary = result.pageSummary.trim();
    if (summary) summaries.push(summary);
    for (const example of result.examples) {
      const key = normalizeBodyKey(example.body);
      if (!key || seenBodies.has(key)) continue;
      seenBodies.add(key);
      examples.push({
        ...example,
        exampleIndex: examples.length,
      });
    }
  }

  if (examples.length > 0) {
    return {
      status: "enriched",
      pageSummary:
        summaries[0] ??
        `Extracted ${examples.length} examples across ${meta.enrichPassCount} enrich passes.`,
      examples,
      ...meta,
    };
  }

  // Prefer a concrete section failure reason over a generic miss.
  const failed = input.sectionResults.find(
    (result) =>
      result.status === "skipped" &&
      (result.reason === "llm_failed" || result.reason === "empty_extraction"),
  );
  if (failed && failed.status === "skipped") {
    return {
      status: "skipped",
      reason: failed.reason,
      detail: [
        failed.detail,
        `Sectioned retry: ${input.sectionCount} packed batches, ${input.sectionsWithCandidates} enrich passes, 0 examples merged.`,
      ]
        .filter(Boolean)
        .join(" "),
      ...meta,
    };
  }

  return {
    status: "skipped",
    reason: "empty_extraction",
    detail: `Sectioned retry found no examples (${input.sectionCount} packed batches, ${input.sectionsWithCandidates} enrich passes).`,
    ...meta,
  };
}
