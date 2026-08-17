import { Agent } from "@mastra/core/agent";
import { z } from "zod";
import type { KapaRetrievedChunk } from "./kapa-retrieve.js";
import {
  primaryAuxiliaryModelId,
  resolveRewriteModelConfig,
} from "../llm/chat-model-config.js";
import { agentStructuredOutput } from "../llm/agent-structured-output.js";
import { logVerbose, logWarn } from "../lib/logger.js";
import {
  COVERAGE_FULL_AVG_TOP3,
  COVERAGE_FULL_MAX_SCORE,
  RELEVANCE_THRESHOLD,
} from "../vector/constants.js";

export type AnswerMode = "full" | "partial" | "none";
export type CoverageTier = "tier0" | "tier1_heuristic" | "tier2_llm";

export type CoverageAssessment = {
  answerMode: AnswerMode;
  coverageTier: CoverageTier;
  coverageGraderUsed: boolean;
  coverageReason?: string;
  relaxedPassUsed: boolean;
  coverageModelId?: string;
};

const graderOutputSchema = z.object({
  coverage: z.enum(["full", "partial", "none"]),
  reason: z.string().min(1).max(400),
});

const COVERAGE_GRADER_TEMPERATURE = 0;

const GRADER_INSTRUCTIONS = `You are a coverage grader for RAG retrieval.

Given the user's question and retrieved source previews (with rerank scores), decide whether the sources are sufficient to answer the question.

Rules:
- "full": sources clearly cover the question; a thorough answer is supported.
- "partial": sources are related but incomplete, outdated for the question, or miss key aspects.
- "none": sources do not substantively answer the question (wrong topic or no usable facts).

Important:
- If retrieval scores already passed the strict relevance threshold, "none" is NOT allowed — use "partial" at minimum.
- For "what are the X" / list/overview questions, a source that lists or defines X is at least "partial"; use "full" when the list is clearly the right topic.
- Be strict about "full": nearby or tangential docs are "partial", not "full".`;

function chunkPreview(chunk: KapaRetrievedChunk, maxChars = 200): string {
  const text = chunk.text.trim();
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}…`;
}

function isAmbiguousZone(input: {
  relaxedPassUsed: boolean;
  maxChunkScore: number;
  avgTop3Score: number;
}): boolean {
  if (input.relaxedPassUsed) return false;
  if (input.maxChunkScore < RELEVANCE_THRESHOLD) return false;
  return !(
    input.maxChunkScore >= COVERAGE_FULL_MAX_SCORE &&
    input.avgTop3Score >= COVERAGE_FULL_AVG_TOP3
  );
}

/** Never let the grader veto chunks that already cleared strict relevance. */
function clampGraderCoverage(input: {
  coverage: AnswerMode;
  reason: string;
  maxChunkScore: number;
  chunkCount: number;
}): { coverage: AnswerMode; reason: string } {
  if (
    input.coverage === "none" &&
    input.chunkCount > 0 &&
    input.maxChunkScore >= RELEVANCE_THRESHOLD
  ) {
    return {
      coverage: "partial",
      reason: `${input.reason} (retrieval scores passed threshold ${RELEVANCE_THRESHOLD}; capped from none).`,
    };
  }
  return { coverage: input.coverage, reason: input.reason };
}

async function runCoverageGrader(input: {
  question: string;
  chunks: KapaRetrievedChunk[];
  maxChunkScore: number;
  avgTop3Score: number;
  requestContext?: { get?: (key: string) => unknown };
}): Promise<{ coverage: AnswerMode; reason: string; modelId: string } | null> {
  const previews = input.chunks.slice(0, 5).map((chunk, index) => ({
    index,
    title: chunk.title,
    section: chunk.section || chunk.category,
    score: chunk.score,
    preview: chunkPreview(chunk),
  }));

  if (previews.length === 0) return null;

  const model = resolveRewriteModelConfig(input.requestContext);
  const coverageModelId = primaryAuxiliaryModelId(input.requestContext);

  const agent = new Agent({
    id: "coverage-grader-agent",
    name: "Coverage Grader",
    instructions: GRADER_INSTRUCTIONS,
    model,
  });

  try {
    const object = await agentStructuredOutput(
      agent,
      [
        `Question: ${input.question}`,
        "",
        `Retrieval already passed strict relevance threshold ${RELEVANCE_THRESHOLD} (max score ${input.maxChunkScore.toFixed(2)}, avg top-3 ${input.avgTop3Score.toFixed(2)}). Do not return "none".`,
        "",
        "Retrieved source previews:",
        JSON.stringify(previews),
      ].join("\n"),
      graderOutputSchema,
      { temperature: COVERAGE_GRADER_TEMPERATURE },
    );
    if (!object) return null;

    const clamped = clampGraderCoverage({
      coverage: object.coverage,
      reason: object.reason.trim(),
      maxChunkScore: input.maxChunkScore,
      chunkCount: input.chunks.length,
    });

    logVerbose("Coverage grader finished", "CoverageGrader", {
      question: input.question,
      coverage: clamped.coverage,
      rawCoverage: object.coverage,
      previewCount: previews.length,
      modelId: coverageModelId,
    });

    return { coverage: clamped.coverage, reason: clamped.reason, modelId: coverageModelId };
  } catch (error) {
    logWarn(
      error instanceof Error ? error.message : "Coverage grader failed",
      "CoverageGrader",
      { question: input.question },
    );
    return null;
  }
}

export async function assessCoverage(input: {
  question: string;
  chunks: KapaRetrievedChunk[];
  insufficient: boolean;
  relaxedPassUsed: boolean;
  weakEvidenceUsed?: boolean;
  maxChunkScore?: number;
  avgTop3Score?: number;
  requestContext?: { get?: (key: string) => unknown };
}): Promise<CoverageAssessment> {
  const relaxedPassUsed = input.relaxedPassUsed;
  const weakEvidenceUsed = Boolean(input.weakEvidenceUsed);

  if (weakEvidenceUsed && input.chunks.length > 0) {
    return {
      answerMode: "partial",
      coverageTier: "tier1_heuristic",
      coverageGraderUsed: false,
      coverageReason:
        "Matches were below the normal relevance threshold; answer only from these weak matches.",
      relaxedPassUsed,
    };
  }

  if (input.insufficient || input.chunks.length === 0) {
    return {
      answerMode: "none",
      coverageTier: "tier0",
      coverageGraderUsed: false,
      coverageReason: "No chunks passed the relevance threshold.",
      relaxedPassUsed,
    };
  }

  const maxChunkScore = input.maxChunkScore ?? 0;
  const avgTop3Score = input.avgTop3Score ?? 0;

  if (relaxedPassUsed) {
    return {
      answerMode: "partial",
      coverageTier: "tier1_heuristic",
      coverageGraderUsed: false,
      coverageReason:
        "Relaxed threshold (0.50) was required to retrieve sources.",
      relaxedPassUsed,
    };
  }

  if (maxChunkScore < RELEVANCE_THRESHOLD) {
    return {
      answerMode: "partial",
      coverageTier: "tier1_heuristic",
      coverageGraderUsed: false,
      coverageReason: `Max chunk score ${maxChunkScore.toFixed(2)} is below strict threshold ${RELEVANCE_THRESHOLD}.`,
      relaxedPassUsed,
    };
  }

  if (
    maxChunkScore >= COVERAGE_FULL_MAX_SCORE &&
    avgTop3Score >= COVERAGE_FULL_AVG_TOP3
  ) {
    return {
      answerMode: "full",
      coverageTier: "tier1_heuristic",
      coverageGraderUsed: false,
      coverageReason: `Strong scores: max ${maxChunkScore.toFixed(2)}, avg top-3 ${avgTop3Score.toFixed(2)}.`,
      relaxedPassUsed,
    };
  }

  if (isAmbiguousZone({ relaxedPassUsed, maxChunkScore, avgTop3Score })) {
    const graded = await runCoverageGrader({
      question: input.question,
      chunks: input.chunks,
      maxChunkScore,
      avgTop3Score,
      requestContext: input.requestContext,
    });

    if (graded) {
      return {
        answerMode: graded.coverage,
        coverageTier: "tier2_llm",
        coverageGraderUsed: true,
        coverageReason: graded.reason,
        relaxedPassUsed,
        coverageModelId: graded.modelId,
      };
    }

    return {
      answerMode: "partial",
      coverageTier: "tier1_heuristic",
      coverageGraderUsed: false,
      coverageReason: `Ambiguous scores (max ${maxChunkScore.toFixed(2)}, avg top-3 ${avgTop3Score.toFixed(2)}); grader unavailable, defaulting to partial.`,
      relaxedPassUsed,
    };
  }

  return {
    answerMode: "partial",
    coverageTier: "tier1_heuristic",
    coverageGraderUsed: false,
    coverageReason: `Scores in borderline range: max ${maxChunkScore.toFixed(2)}, avg top-3 ${avgTop3Score.toFixed(2)}.`,
    relaxedPassUsed,
  };
}

export function instructionForAnswerMode(
  mode: AnswerMode,
  coverageReason?: string,
): string {
  if (mode === "none") {
    return `No valid sources were found in the knowledge base for this question.
Tell the user clearly that the knowledge sources do not confirm their query.
Do not invent or guess information.`;
  }

  if (mode === "partial") {
    const reasonLine = coverageReason
      ? `\nCoverage note: ${coverageReason}`
      : "";
    return `Based on the available sources, you can only partially answer this question.
Start by clearly stating that the knowledge sources do not fully cover the user's query.
Only state what the sources explicitly support — do not invent facts beyond them.
Cite with inline markdown links [title](url).
If the sources do not cover part of the question, say the knowledge sources do not fully confirm it.${reasonLine}`;
  }

  return `Answer only from the retrieved sources below.
Cite sources with inline markdown links [title](url).
Be verbose and thorough: explain concepts fully, include examples and implementation details from the sources, and walk through how to use or configure things when relevant.
If the sources do not contain enough information, say the knowledge sources do not confirm it.`;
}
