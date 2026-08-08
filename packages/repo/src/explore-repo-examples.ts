import path from "node:path";
import type { MastraLanguageModel } from "@mastra/core/agent";
import {
  buildExampleEmbedText,
  normalizeExampleLanguage,
  type EnrichedExample,
} from "@ledgeindex/core/enrich";
import { createRepoExploreAgent } from "./agents/repo-explore-agent.js";
import { REPO_EXPLORE_MAX_STEPS } from "./constants.js";
import {
  repoExploreOutputSchema,
  type RepoExploreOutput,
} from "./schemas.js";

export type ExploreRepoExamplesInput = {
  repoPath: string;
  libraryName?: string;
  model: MastraLanguageModel;
  maxSteps?: number;
};

export type ExploreRepoExamplesResult = {
  status: "enriched" | "skipped";
  reason?: "no_examples" | "llm_failed";
  pageSummary?: string;
  libraryName?: string;
  filesConsulted?: string[];
  /** Main usage example mapped into EnrichedExample[] (0 or 1 item). */
  examples: EnrichedExample[];
  raw?: RepoExploreOutput;
  exploreNotes?: string;
  error?: string;
  toolCalls?: number;
  toolResults?: number;
};

function toEnriched(
  output: RepoExploreOutput,
  libraryName: string,
): EnrichedExample[] {
  const ex = output.main_usage_example;
  if (!ex?.body?.trim()) return [];
  const section = ex.source_path?.trim() || "Usage";
  return [
    {
      kind: "usage",
      title: ex.title,
      description: ex.description,
      language: normalizeExampleLanguage(ex.language),
      body: ex.body.trim(),
      section,
      exampleIndex: 0,
      embedText: buildExampleEmbedText({
        pageTitle: libraryName,
        pageSummary: output.page_summary,
        kind: "usage",
        title: ex.title,
        description: ex.description,
        body: ex.body,
        section,
        language: normalizeExampleLanguage(ex.language),
      }),
      confidence: "extracted" as const,
    },
  ];
}

function countTools(result: {
  steps?: Array<{ toolCalls?: unknown[]; toolResults?: unknown[] }>;
}): { toolCalls: number; toolResults: number } {
  let toolCalls = 0;
  let toolResults = 0;
  for (const step of result.steps ?? []) {
    if (Array.isArray(step.toolCalls)) toolCalls += step.toolCalls.length;
    if (Array.isArray(step.toolResults)) toolResults += step.toolResults.length;
  }
  return { toolCalls, toolResults };
}

/**
 * Explore with tools, then structure via a second model pass (useAgent).
 * Output: one main usage example.
 */
export async function exploreRepoExamples(
  input: ExploreRepoExamplesInput,
): Promise<ExploreRepoExamplesResult> {
  const libraryName =
    input.libraryName?.trim() ||
    path.basename(input.repoPath.replace(/[/\\]+$/, "")) ||
    "library";
  const maxSteps = input.maxSteps ?? REPO_EXPLORE_MAX_STEPS;

  const explorer = createRepoExploreAgent({
    repoPath: input.repoPath,
    model: input.model,
    libraryName,
    maxSteps,
  });

  const explorePrompt = [
    `Explore this repository for the main / basic usage example.`,
    `Repo path: ${input.repoPath}`,
    `Library: ${libraryName}`,
    ``,
    `You MUST call list_dir and read_file (at least README.md).`,
    `Do not invent APIs. When done, reply with exactly: done`,
  ].join("\n");

  let exploreNotes = "";
  let toolCalls = 0;
  let toolResults = 0;

  try {
    const result = await explorer.generate(explorePrompt, {
      maxSteps,
      structuredOutput: {
        schema: repoExploreOutputSchema,
        model: input.model,
        useAgent: true,
        jsonPromptInjection: "inline",
      },
    } as never);

    exploreNotes =
      typeof result.text === "string" ? result.text.trim() : "";
    const counts = countTools(
      result as {
        steps?: Array<{ toolCalls?: unknown[]; toolResults?: unknown[] }>;
      },
    );
    toolCalls = counts.toolCalls;
    toolResults = counts.toolResults;

    const raw = result.object as RepoExploreOutput | undefined;
    if (!raw || typeof raw !== "object") {
      return {
        status: "skipped",
        reason: "llm_failed",
        examples: [],
        exploreNotes,
        error: "structured output missing",
        toolCalls,
        toolResults,
      };
    }

    const examples = toEnriched(raw, libraryName).filter((e) => e.body.length > 0);
    if (examples.length === 0) {
      return {
        status: "skipped",
        reason: "no_examples",
        pageSummary: raw.page_summary,
        libraryName: raw.library_name,
        filesConsulted: raw.files_consulted,
        examples: [],
        raw,
        exploreNotes,
        toolCalls,
        toolResults,
      };
    }

    return {
      status: "enriched",
      pageSummary: raw.page_summary,
      libraryName: raw.library_name,
      filesConsulted: raw.files_consulted,
      examples,
      raw,
      exploreNotes,
      toolCalls,
      toolResults,
    };
  } catch (err) {
    return {
      status: "skipped",
      reason: "llm_failed",
      examples: [],
      exploreNotes,
      error: err instanceof Error ? err.message : String(err),
      toolCalls,
      toolResults,
    };
  }
}
