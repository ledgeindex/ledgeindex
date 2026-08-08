import path from "node:path";
import { Agent } from "@mastra/core/agent";
import type { MastraLanguageModel } from "@mastra/core/agent";
import {
  buildExampleEmbedText,
  normalizeExampleLanguage,
  type EnrichedExample,
} from "@ledgeindex/core/enrich";
import { createRepoProfilerExploreAgent } from "./agents/repo-profiler-explore-agent.js";
import { REPO_EXPLORE_MAX_STEPS } from "./constants.js";
import {
  repoProfileCoreSchema,
  repoProfileExamplesSchema,
  type RepoProfile,
  type RepoProfileCore,
  type RepoProfileExample,
} from "./profile-schemas.js";

export type ProfileRepoInput = {
  repoPath: string;
  libraryName?: string;
  model: MastraLanguageModel;
  maxSteps?: number;
  /** Cap examples returned (default 6). */
  maxExamples?: number;
};

export type ProfileRepoResult = {
  status: "profiled" | "skipped";
  reason?: "llm_failed" | "empty";
  profile?: RepoProfile;
  /** Examples mapped to LedgeIndex EnrichedExample primitives. */
  examples: EnrichedExample[];
  exploreNotes?: string;
  error?: string;
  toolCalls?: number;
  toolResults?: number;
};

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

function digestExploreSteps(result: {
  text?: string;
  steps?: Array<{
    text?: string;
    toolResults?: Array<{
      payload?: { result?: unknown };
      result?: unknown;
    }>;
  }>;
}): string {
  const parts: string[] = [];
  if (typeof result.text === "string" && result.text.trim()) {
    parts.push(result.text.trim());
  }
  for (const step of result.steps ?? []) {
    if (typeof step.text === "string" && step.text.trim()) {
      parts.push(step.text.trim());
    }
    for (const tr of step.toolResults ?? []) {
      const payload =
        tr.payload && typeof tr.payload === "object" && "result" in tr.payload
          ? (tr.payload as { result?: unknown }).result
          : tr.result;
      if (payload == null) continue;
      const text =
        typeof payload === "string" ? payload : JSON.stringify(payload);
      if (text.trim()) parts.push(text.trim().slice(0, 4000));
    }
  }
  const joined = parts.join("\n\n---\n\n");
  return joined.length > 48_000 ? `${joined.slice(0, 48_000)}\n…[truncated]` : joined;
}

function toEnriched(
  examples: RepoProfileExample[],
  libraryName: string,
  pageSummary: string,
): EnrichedExample[] {
  return examples
    .map((ex, exampleIndex) => {
      const body = ex.body.trim();
      if (!body) return null;
      const section = ex.sourcePath?.trim() || "Usage";
      return {
        kind: ex.kind,
        title: ex.title,
        description: ex.description,
        language: normalizeExampleLanguage(ex.language),
        body,
        section,
        exampleIndex,
        embedText: buildExampleEmbedText({
          pageTitle: libraryName,
          pageSummary,
          kind: ex.kind,
          title: ex.title,
          description: ex.description,
          body,
          section,
          language: ex.language,
        }),
        confidence: "extracted" as const,
      };
    })
    .filter((ex): ex is EnrichedExample => ex != null);
}

function createStructurer(model: MastraLanguageModel): Agent {
  return new Agent({
    id: "repo-profiler-structurer",
    name: "Repo Profiler Structurer",
    instructions: `You turn repository explore notes into strict structured JSON.
Only use facts present in the notes. Never invent APIs, imports, or code.
If something is unknown, omit it or use null — do not guess.`,
    model,
  });
}

/**
 * Multi-step repo profiler:
 * 1) explore with FS tools
 * 2) structure description + primitives
 * 3) structure usage/setup examples
 */
export async function profileRepo(
  input: ProfileRepoInput,
): Promise<ProfileRepoResult> {
  const libraryName =
    input.libraryName?.trim() ||
    path.basename(input.repoPath.replace(/[/\\]+$/, "")) ||
    "library";
  const maxSteps = input.maxSteps ?? REPO_EXPLORE_MAX_STEPS;
  const maxExamples = input.maxExamples ?? 6;

  const explorer = createRepoProfilerExploreAgent({
    repoPath: input.repoPath,
    model: input.model,
    libraryName,
    maxSteps,
  });

  const explorePrompt = [
    `Explore this repository to support a full profile.`,
    `Repo path: ${input.repoPath}`,
    `Library: ${libraryName}`,
    ``,
    `You MUST call list_dir and read_file (at least README and package.json when present).`,
    `Gather: purpose, main exports/APIs, and where usage examples live.`,
    `Do not invent APIs. When done, reply with exactly: done`,
  ].join("\n");

  let exploreNotes = "";
  let toolCalls = 0;
  let toolResults = 0;

  try {
    const exploreResult = await explorer.generate(explorePrompt, {
      maxSteps,
    } as never);

    exploreNotes = digestExploreSteps(
      exploreResult as {
        text?: string;
        steps?: Array<{
          text?: string;
          toolResults?: Array<{
            payload?: { result?: unknown };
            result?: unknown;
          }>;
        }>;
      },
    );
    const counts = countTools(
      exploreResult as {
        steps?: Array<{ toolCalls?: unknown[]; toolResults?: unknown[] }>;
      },
    );
    toolCalls = counts.toolCalls;
    toolResults = counts.toolResults;

    if (!exploreNotes.trim()) {
      return {
        status: "skipped",
        reason: "empty",
        examples: [],
        exploreNotes,
        error: "explore produced no notes",
        toolCalls,
        toolResults,
      };
    }

    const structurer = createStructurer(input.model);

    const corePrompt = [
      `Build a repository profile from these explore notes.`,
      `Library hint: ${libraryName}`,
      ``,
      `Return description, one-line summary, and up to 16 real primitives (exports/APIs).`,
      `files_consulted must list paths that appear in the notes.`,
      ``,
      `=== EXPLORE NOTES ===`,
      exploreNotes,
    ].join("\n");

    const coreResult = await structurer.generate(corePrompt, {
      structuredOutput: {
        schema: repoProfileCoreSchema,
        model: input.model,
        jsonPromptInjection: "inline",
      },
    } as never);

    const core = coreResult.object as RepoProfileCore | undefined;
    if (!core || typeof core !== "object") {
      return {
        status: "skipped",
        reason: "llm_failed",
        examples: [],
        exploreNotes,
        error: "profile core structured output missing",
        toolCalls,
        toolResults,
      };
    }

    const examplesPrompt = [
      `Extract up to ${maxExamples} grounded code/setup/usage examples from these explore notes.`,
      `Library: ${core.libraryName || libraryName}`,
      `Prefer README usage blocks and files under examples/.`,
      `Copy code exactly; never invent. Prefer kind "usage" or "setup".`,
      `If none exist, return an empty examples array.`,
      ``,
      `=== EXPLORE NOTES ===`,
      exploreNotes,
    ].join("\n");

    const examplesResult = await structurer.generate(examplesPrompt, {
      structuredOutput: {
        schema: repoProfileExamplesSchema,
        model: input.model,
        jsonPromptInjection: "inline",
      },
    } as never);

    const rawExamples =
      (examplesResult.object as { examples?: RepoProfileExample[] } | undefined)
        ?.examples ?? [];
    const examples = rawExamples.slice(0, maxExamples);

    const profile: RepoProfile = {
      libraryName: core.libraryName || libraryName,
      description: core.description,
      summary: core.summary,
      primitives: core.primitives ?? [],
      examples,
      filesConsulted: core.filesConsulted ?? [],
      profiledAt: new Date().toISOString(),
    };

    return {
      status: "profiled",
      profile,
      examples: toEnriched(
        examples,
        profile.libraryName,
        profile.summary || profile.description,
      ),
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
