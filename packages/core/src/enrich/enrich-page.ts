// @ts-nocheck
import { Agent } from "@mastra/core/agent";
import { TokenLimiterProcessor } from "@mastra/core/processors";
import { classifyHeuristicEnrichSkip, hasExampleCandidates } from "./detect-example-candidates.js";
import { mapExtractedExampleToEnriched } from "./map-enriched-example.js";
import {
  enrichLlmOutputSchema,
  type EnrichPageResult,
  type EnrichedExample,
} from "./schemas.js";
import {
  getEnrichModel,
  hasEnrichLlm,
  type LedgeIndexLlmModel,
} from "../llm/models.js";
import { countTokens, truncateToTokenLimit } from "../lib/count-tokens.js";
import { logVerbose, logWarn } from "../lib/logger.js";
import { mergeSectionEnrichResults } from "./merge-section-enrich-results.js";
import { splitEnrichSections } from "./split-enrich-sections.js";

/** Fallback soft cap (~18k chars) when no model context length is provided. */
export const ENRICH_MARKDOWN_DEFAULT_MAX_TOKENS = 4_500;
/**
 * Absolute ceiling only — real pack size comes from the model context window.
 * High enough that a 128k+ context is not artificially capped at 25k.
 */
export const ENRICH_MARKDOWN_HARD_MAX_TOKENS = 200_000;
/** @deprecated Prefer token budgets — kept for public API compatibility. */
export const ENRICH_MARKDOWN_MAX_CHARS = ENRICH_MARKDOWN_DEFAULT_MAX_TOKENS * 4;
/** @deprecated Prefer ENRICH_MARKDOWN_HARD_MAX_TOKENS. */
export const ENRICH_MARKDOWN_HARD_MAX_CHARS = ENRICH_MARKDOWN_HARD_MAX_TOKENS * 4;
/** Structured-output + wrapper headroom on top of system instructions. */
const ENRICH_OUTPUT_RESERVE_TOKENS = 1_024;
const ENRICH_PROMPT_OVERHEAD_TOKENS = 128;

const ENRICH_INSTRUCTIONS = `You are a documentation example extraction engine.

Analyze the provided page markdown. Extract every distinct, grounded example that teaches how to do something.

Include:
- code: runnable snippets, SDK calls, curl, shell
- setup: install / env / getting started steps (prose or mixed)
- usage: how-to procedures, request/response walkthroughs
- config: YAML/JSON/TOML samples or concrete config steps
- api_response: HTTP API response samples (2xx/4xx/5xx) with status line and body — especially error JSON with error.code enums (FORBIDDEN, NOT_FOUND, etc.). Populate apiResponse (httpStatus, statusText, errorCode, contentType). Set language to json for JSON bodies. Use this instead of code when the example is a response payload, not client SDK code.
- other: only if it is still a concrete example

Rules:
- Extract ONLY what appears on the page. Never invent examples.
- Split different intents into separate objects (Install vs Auth vs First request).
- If the page has fenced code, curl, SDK snippets, or request/response samples, you MUST extract them — do not return an empty list.
- If the page truly has no real examples, return extracted_examples as an empty array.
- Prefer copying code and steps faithfully; do not rewrite identifiers.
- Never prefix exports with \`global.\` or invent wrappers — copy code as written on the page.
- For kind code or config, language MUST be one of:
  javascript | typescript | jsx | tsx | python | json | yaml | bash | docker | html | css | scss | sql | go | rust | java | kotlin | swift | ruby | php | csharp | cpp | c | markdown | toml | xml | other
  Never leave it null for code snippets. Prefer full names (javascript not js, typescript not ts, docker not dockerfile). Use other only when the snippet is code but not one of the listed languages.
- language is null only for prose-only setup/usage with no code fence.
- body holds the raw code OR the concrete steps as text.
- section MUST be the nearest markdown heading above that example (e.g. "Quickstart", "Use your agent"). Never leave it empty.

Output ONLY structured data matching the schema.`;

const ENRICH_INSTRUCTION_TOKENS = countTokens(ENRICH_INSTRUCTIONS);

/** gpt-tokenizer count of markdown text (same encoder as Pindown billing / tripwires). */
export function countEnrichTokens(text: string): number {
  return countTokens(text);
}

/** @deprecated Use countEnrichTokens(text) — chars/4 is no longer the enrich path. */
export function estimateEnrichTokens(chars: number): number {
  if (!Number.isFinite(chars) || chars <= 0) return 0;
  return Math.ceil(chars / 4);
}

/** How many markdown tokens we can send given the model context window. */
export function resolveEnrichMarkdownMaxTokens(
  contextTokenLimit?: number,
): number {
  if (
    typeof contextTokenLimit !== "number" ||
    !Number.isFinite(contextTokenLimit) ||
    contextTokenLimit <= 0
  ) {
    return ENRICH_MARKDOWN_DEFAULT_MAX_TOKENS;
  }
  const reserve =
    ENRICH_INSTRUCTION_TOKENS +
    ENRICH_OUTPUT_RESERVE_TOKENS +
    ENRICH_PROMPT_OVERHEAD_TOKENS;
  return Math.min(
    ENRICH_MARKDOWN_HARD_MAX_TOKENS,
    Math.max(512, Math.floor(contextTokenLimit) - reserve),
  );
}

/** @deprecated Prefer resolveEnrichMarkdownMaxTokens — char budget is approximate. */
export function resolveEnrichMarkdownMaxChars(
  contextTokenLimit?: number,
): number {
  return resolveEnrichMarkdownMaxTokens(contextTokenLimit) * 4;
}

function modelLabel(model: LedgeIndexLlmModel): string {
  return typeof model === "string" ? model : model.id;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** AG native / some local serves reject overlapping chat completions. */
function isRetryableBusyError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const err = error as {
    statusCode?: number;
    message?: string;
    responseBody?: string;
    data?: { error?: { message?: string } };
  };
  if (err.statusCode === 429) return true;
  const text = [
    err.message,
    err.responseBody,
    err.data?.error?.message,
  ]
    .filter((part): part is string => typeof part === "string")
    .join(" ");
  return /server busy|single-session|rate limit|too many requests/i.test(text);
}

function sizeFields(
  markdown: string,
  contextTokenLimit?: number,
): Pick<
  Extract<EnrichPageResult, { status: "skipped" }>,
  "markdownChars" | "estimatedTokens" | "contextTokenLimit"
> {
  return {
    markdownChars: markdown.length,
    estimatedTokens: countTokens(markdown),
    ...(typeof contextTokenLimit === "number" &&
    Number.isFinite(contextTokenLimit) &&
    contextTokenLimit > 0
      ? { contextTokenLimit: Math.floor(contextTokenLimit) }
      : {}),
  };
}

const ENRICH_BUSY_MAX_ATTEMPTS = 4;
const ENRICH_BUSY_BASE_DELAY_MS = 750;
/** One extra attempt when the model returns invalid / empty structured output. */
const ENRICH_VALIDATION_MAX_ATTEMPTS = 2;
/** Headroom for validation-retry correction text on top of the first user message. */
const ENRICH_VALIDATION_RETRY_PROMPT_RESERVE = 384;

function createEnrichAgent(
  model: LedgeIndexLlmModel,
  inputTokenLimit: number,
): Agent {
  return new Agent({
    id: "page-example-enrich",
    name: "Page Example Enrich",
    instructions: ENRICH_INSTRUCTIONS,
    model,
    inputProcessors: [
      new TokenLimiterProcessor({
        limit: inputTokenLimit,
        strategy: "truncate",
        countMode: "cumulative",
        trimMode: "best-fit",
      }),
    ],
  });
}

export type EnrichSectionProgress = {
  /** 1-based section currently running (or just finished when done=true). */
  sectionCurrent: number;
  sectionTotal: number;
  url: string;
  /** True after the last section for this page finished. */
  done?: boolean;
};

export type EnrichPageInput = {
  url: string;
  title: string;
  markdown: string;
  /** Override model (e.g. lmstudio/qwen2.5-coder-7b-instruct). */
  model?: LedgeIndexLlmModel;
  /** Skip the LLM even if candidates exist (tests). */
  skipLlm?: boolean;
  /**
   * Model context window (tokens) from AutomationGhost / LM Studio.
   * Used to size markdown truncation and TokenLimiterProcessor.
   */
  contextTokenLimit?: number;
  /**
   * `whole` (default): one LLM pass over the page (truncated to context).
   * `sectioned`: Mastra semantic-markdown sections, enrich each, then merge.
   * Only intended for explicit failed-retry flows.
   */
  mode?: "whole" | "sectioned";
  /** Fired as sectioned enrich advances (retry UI progress). */
  onSectionProgress?: (progress: EnrichSectionProgress) => void;
};

export async function enrichPage(
  input: EnrichPageInput,
): Promise<EnrichPageResult> {
  const markdown = input.markdown?.trim() ?? "";
  const markdownChars = markdown.length;
  const markdownTokens = countTokens(markdown);
  const contextTokenLimit =
    typeof input.contextTokenLimit === "number" &&
    Number.isFinite(input.contextTokenLimit) &&
    input.contextTokenLimit > 0
      ? Math.floor(input.contextTokenLimit)
      : undefined;
  const size = sizeFields(markdown, contextTokenLimit);
  const mode = input.mode === "sectioned" ? "sectioned" : "whole";

  const heuristicSkip = classifyHeuristicEnrichSkip(markdown);
  if (heuristicSkip) {
    return {
      status: "skipped",
      reason: heuristicSkip.reason,
      detail: heuristicSkip.detail,
      ...size,
    };
  }

  if (input.skipLlm || !hasEnrichLlm(input.model)) {
    return {
      status: "skipped",
      reason: "no_llm",
      detail:
        "Enrich LLM is not configured — page had example signals but was not sent to a model.",
      ...size,
    };
  }

  if (mode === "sectioned") {
    return enrichPageSectioned({
      input,
      markdown,
      markdownChars,
      markdownTokens,
      contextTokenLimit,
      size,
    });
  }

  return enrichPageWhole({
    input,
    markdown,
    markdownChars,
    markdownTokens,
    contextTokenLimit,
    size,
  });
}

/** Soft cap so one section still fits structured extract even with a huge context window. */
const ENRICH_SECTION_SOFT_MAX_TOKENS = 3_000;

async function enrichPageSectioned(args: {
  input: EnrichPageInput;
  markdown: string;
  markdownChars: number;
  markdownTokens: number;
  contextTokenLimit?: number;
  size: ReturnType<typeof sizeFields>;
}): Promise<EnrichPageResult> {
  const { input, markdown, markdownChars, markdownTokens, contextTokenLimit, size } =
    args;
  // Pack to the real model budget (ctx − reserves). No extra 3k soft cap —
  // goal is as few requests as possible that each fill the available window.
  const sectionBudget = resolveEnrichMarkdownMaxTokens(contextTokenLimit);

  // Doc already fits one safe pass — no split.
  if (markdownTokens <= sectionBudget) {
    logVerbose("Sectioned retry unnecessary — page fits one pass", "EnrichPage", {
      url: input.url,
      markdownTokens,
      sectionBudget,
      contextTokenLimit: contextTokenLimit ?? null,
    });
    return enrichPageWhole({
      input: { ...input, mode: "whole" },
      markdown,
      markdownChars,
      markdownTokens,
      contextTokenLimit,
      size,
    });
  }

  const sections = await splitEnrichSections(markdown, {
    maxTokens: sectionBudget,
  });
  const candidateSections = sections.filter((section) =>
    hasExampleCandidates(section.markdown),
  );

  logVerbose("Enriching page by packed sections (retry path)", "EnrichPage", {
    url: input.url,
    packedBatches: sections.length,
    candidateBatches: candidateSections.length,
    sectionBudget,
    markdownTokens,
    contextTokenLimit: contextTokenLimit ?? null,
  });

  // Nothing useful to split into — fall back to a single whole-page pass.
  if (candidateSections.length <= 1) {
    return enrichPageWhole({
      input: { ...input, mode: "whole" },
      markdown,
      markdownChars,
      markdownTokens,
      contextTokenLimit,
      size,
    });
  }

  const sectionResults: EnrichPageResult[] = [];
  // Sequential: local serves are typically single-session.
  for (let i = 0; i < candidateSections.length; i++) {
    const section = candidateSections[i]!;
    input.onSectionProgress?.({
      sectionCurrent: i + 1,
      sectionTotal: candidateSections.length,
      url: input.url,
    });
    const result = await enrichPageWhole({
      input: {
        ...input,
        mode: "whole",
        markdown: section.markdown,
      },
      markdown: section.markdown,
      markdownChars: section.charCount,
      markdownTokens: section.tokenCount,
      contextTokenLimit,
      size: sizeFields(section.markdown, contextTokenLimit),
      pageTitle: input.title,
      fullPageMarkdown: markdown,
      sectionIndex: i,
      sectionCount: candidateSections.length,
    });
    sectionResults.push(result);
  }

  input.onSectionProgress?.({
    sectionCurrent: candidateSections.length,
    sectionTotal: candidateSections.length,
    url: input.url,
    done: true,
  });

  return mergeSectionEnrichResults({
    sectionResults,
    markdownChars,
    estimatedTokens: markdownTokens,
    contextTokenLimit,
    sectionCount: sections.length,
    sectionsWithCandidates: candidateSections.length,
  });
}

async function enrichPageWhole(args: {
  input: EnrichPageInput;
  markdown: string;
  markdownChars: number;
  markdownTokens: number;
  contextTokenLimit?: number;
  size: ReturnType<typeof sizeFields>;
  /** Prefer full-page markdown when resolving section headings during sectioned runs. */
  fullPageMarkdown?: string;
  pageTitle?: string;
  sectionIndex?: number;
  sectionCount?: number;
}): Promise<EnrichPageResult> {
  const {
    input,
    markdown,
    markdownChars,
    markdownTokens,
    contextTokenLimit,
    size,
  } = args;
  const sectionResolveMarkdown = args.fullPageMarkdown ?? markdown;
  const model = input.model ?? getEnrichModel();
  const markdownMaxTokens = resolveEnrichMarkdownMaxTokens(contextTokenLimit);
  const truncated = truncateToTokenLimit(markdown, markdownMaxTokens);
  const truncatedMarkdown = truncated.text;
  const wasTruncated = truncated.truncated;

  // Input processor safety net: Mastra truncates messages to this token limit.
  const inputTokenLimit = contextTokenLimit
    ? Math.max(512, contextTokenLimit - ENRICH_OUTPUT_RESERVE_TOKENS)
    : Math.max(
        512,
        ENRICH_INSTRUCTION_TOKENS +
          markdownMaxTokens +
          ENRICH_PROMPT_OVERHEAD_TOKENS,
      );

  const sectionNote =
    typeof args.sectionIndex === "number" && typeof args.sectionCount === "number"
      ? [
          "",
          `Section ${args.sectionIndex + 1} of ${args.sectionCount} (heading-aware split). Extract examples only from this section.`,
        ]
      : [];

  const prompt = [
    `Page URL: ${input.url}`,
    `Page title: ${input.title || "Untitled"}`,
    ...sectionNote,
    ...(wasTruncated
      ? [
          "",
          `Note: page markdown was truncated to fit the model context (${markdownTokens.toLocaleString()} tokens / ${markdownChars.toLocaleString()} chars → ${markdownMaxTokens.toLocaleString()} tokens${contextTokenLimit ? `, ctx ${contextTokenLimit.toLocaleString()}` : ""}).`,
        ]
      : []),
    "",
    "Page markdown:",
    truncatedMarkdown,
  ].join("\n");

  logVerbose("Enriching page examples", "EnrichPage", {
    url: input.url,
    model: modelLabel(model),
    markdownChars,
    markdownTokens,
    contextTokenLimit: contextTokenLimit ?? null,
    markdownMaxTokens,
    wasTruncated,
    inputTokenLimit,
    instructionTokens: ENRICH_INSTRUCTION_TOKENS,
    sectionIndex: args.sectionIndex ?? null,
  });

  try {
    let lastError: unknown;
    let attemptPrompt = prompt;

    for (
      let validationAttempt = 1;
      validationAttempt <= ENRICH_VALIDATION_MAX_ATTEMPTS;
      validationAttempt++
    ) {
      const agentInputLimit =
        inputTokenLimit +
        (validationAttempt > 1 ? ENRICH_VALIDATION_RETRY_PROMPT_RESERVE : 0);

      for (let attempt = 1; attempt <= ENRICH_BUSY_MAX_ATTEMPTS; attempt++) {
        // Fresh agent per call — reusing one agent accumulates turns and can
        // trip TokenLimiterProcessor ("No messages fit") on validation retry.
        const agent = createEnrichAgent(model, agentInputLimit);
        try {
          const result = await agent.generate(attemptPrompt, {
            maxSteps: 1,
            structuredOutput: {
              schema: enrichLlmOutputSchema,
            },
          });

          const parsed = enrichLlmOutputSchema.safeParse(result.object);
          if (!parsed.success) {
            const issueText = parsed.error.issues
              .slice(0, 5)
              .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
              .join("; ");
            const promptTokens = countTokens(attemptPrompt);
            const sizeHint = [
              `${markdownTokens.toLocaleString()} page tok`,
              wasTruncated
                ? `sent ${markdownMaxTokens.toLocaleString()} tok (truncated)`
                : `sent full page`,
              contextTokenLimit
                ? `ctx ${contextTokenLimit.toLocaleString()}`
                : "ctx unknown",
              `prompt ${promptTokens.toLocaleString()} tok`,
            ].join(", ");

            if (validationAttempt < ENRICH_VALIDATION_MAX_ATTEMPTS) {
              logWarn("Enrich LLM output failed schema parse — retrying", "EnrichPage", {
                url: input.url,
                attempt: validationAttempt,
                issues: parsed.error.issues.slice(0, 5),
                objectType: result.object === undefined ? "undefined" : typeof result.object,
                promptTokens,
                wasTruncated,
                markdownMaxTokens,
                contextTokenLimit: contextTokenLimit ?? null,
              });
              attemptPrompt = [
                prompt,
                "",
                "Your previous structured output was invalid.",
                `Validation errors: ${issueText || "expected object, received undefined"}`,
                "Respond again with ONLY a valid JSON object matching the schema:",
                '{ "page_summary": string, "extracted_examples": [ { "kind", "title", "description", "language", "body", "section", "apiResponse" } ] }',
                "This page has example signals (code fences and/or example headings). Extract every grounded example. Only return extracted_examples as [] if there truly are none.",
              ].join("\n");
              break; // next validation attempt
            }

            logWarn("Enrich LLM output failed schema parse", "EnrichPage", {
              url: input.url,
              issues: parsed.error.issues.slice(0, 5),
              objectType: result.object === undefined ? "undefined" : typeof result.object,
              promptTokens,
              wasTruncated,
              markdownMaxTokens,
              contextTokenLimit: contextTokenLimit ?? null,
            });
            return {
              status: "skipped",
              reason: "llm_failed",
              detail: `Model returned invalid structured output: ${issueText || "expected object, received undefined"} (${sizeHint}). Large schema-heavy pages often break structured extract — try Retry failed for a sectioned re-run.`,
              enrichPassCount: 1,
              ...size,
            };
          }

          const pageSummary = parsed.data.page_summary.trim();
          const rawExamples = parsed.data.extracted_examples.filter(
            (ex) => ex.body.trim().length > 0 && ex.title.trim().length > 0,
          );

          if (rawExamples.length === 0) {
            // Heuristic already found example signals — empty LLM output is a miss.
            logWarn("Enrich LLM returned no examples despite candidates", "EnrichPage", {
              url: input.url,
              model: modelLabel(model),
            });
            const truncateNote = wasTruncated
              ? ` Markdown was truncated to fit context (${markdownTokens.toLocaleString()} → ${markdownMaxTokens.toLocaleString()} tokens).`
              : "";
            return {
              status: "skipped",
              reason: "empty_extraction",
              detail: pageSummary
                ? `Model returned no examples despite code/example signals. Summary: ${pageSummary.slice(0, 240)}${truncateNote}`
                : `Model returned no examples despite code fences or example headings on the page.${truncateNote}`,
              enrichPassCount: 1,
              ...size,
            };
          }

          const examples: EnrichedExample[] = rawExamples.map((ex, exampleIndex) =>
            mapExtractedExampleToEnriched({
              ex,
              exampleIndex,
              pageTitle: input.title,
              pageSummary,
              sectionResolveMarkdown,
              fallbackPageTitle: args.pageTitle ?? input.title,
            }),
          );

          return {
            status: "enriched",
            pageSummary,
            examples,
            enrichPassCount: 1,
            ...size,
          };
        } catch (error) {
          lastError = error;
          const message = error instanceof Error ? error.message : String(error);
          const isValidation =
            /structured output validation failed|expected object|invalid input/i.test(
              message,
            );

          if (
            isValidation &&
            validationAttempt < ENRICH_VALIDATION_MAX_ATTEMPTS
          ) {
            logWarn("Enrich structured output error — retrying", "EnrichPage", {
              url: input.url,
              attempt: validationAttempt,
              error: message,
            });
            attemptPrompt = [
              prompt,
              "",
              "Your previous structured output was invalid.",
              `Error: ${message}`,
              "Respond again with ONLY a valid JSON object matching the schema:",
              '{ "page_summary": string, "extracted_examples": [ { "kind", "title", "description", "language", "body", "section" } ] }',
              "This page has example signals (code fences and/or example headings). Extract every grounded example. Only return extracted_examples as [] if there truly are none.",
            ].join("\n");
            break; // next validation attempt
          }

          if (
            isRetryableBusyError(error) &&
            attempt < ENRICH_BUSY_MAX_ATTEMPTS
          ) {
            const delayMs = ENRICH_BUSY_BASE_DELAY_MS * attempt;
            logWarn("Enrich LLM busy — retrying", "EnrichPage", {
              url: input.url,
              model: modelLabel(model),
              attempt,
              delayMs,
              error: message,
            });
            await sleep(delayMs);
            continue;
          }
          throw error;
        }
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error(String(lastError ?? "Enrich failed"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logWarn("Enrich LLM call failed", "EnrichPage", {
      url: input.url,
      model: modelLabel(model),
      error: message,
      markdownChars,
      markdownTokens,
      contextTokenLimit: contextTokenLimit ?? null,
    });
    return {
      status: "skipped",
      reason: "llm_failed",
      detail: `Enrich LLM call failed: ${message.slice(0, 280)}`,
      enrichPassCount: 1,
      ...size,
    };
  }
}
