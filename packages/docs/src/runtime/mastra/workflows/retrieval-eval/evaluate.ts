import { performance } from "node:perf_hooks";
import type { KapaRetrievedChunk } from "../../../retrieval/kapa-retrieve.js";
import { retrieveWithStructuredRewriteInContext } from "../../../retrieval/structured-retrieve.js";
import {
  generateRagAnswer,
  type GeneratedRagAnswer,
} from "./generate-answer.js";
import {
  scoreGeneratedAnswer,
  scoreRetrievalContext,
  type AnswerQualityScores,
  type RetrievalContextScores,
} from "./semantic-score.js";
import type { RetrievalGoldenCase } from "./schemas.js";

export type RetrievalEvalSettings = {
  sourceId: string;
  scope: "personal" | "global";
  hosting: "local" | "cloud";
  strictness: "strict" | "balanced" | "permissive";
  expandPages: boolean;
  concurrency: number;
  profile: "fast" | "pr" | "full";
  scorerModel?: string;
};

export type RetrievalEvalCaseResult = {
  id: string;
  question: string;
  category: string;
  difficulty: "easy" | "medium" | "hard";
  metrics: {
    hitAt1: boolean;
    hitAt3: boolean;
    hitAt5: boolean;
    reciprocalRank: number;
    rejectHit: boolean;
    claimCoverage: number;
    claimsCovered: number;
    claimsTotal: number;
    relaxedPassUsed: boolean;
    weakEvidenceUsed: boolean;
    pageFilterUsed: boolean;
    elapsedMs: number;
  };
  retrievalScores?: RetrievalContextScores;
  answer?: GeneratedRagAnswer & { scores: AnswerQualityScores };
  topChunks: Array<{
    url: string;
    title: string;
    score: number;
    retrievalKind: "direct" | "expanded";
  }>;
  droppedPages: Array<{ url: string; title: string; reason: string }>;
};

export type RetrievalEvalAggregate = {
  cases: number;
  hitAt1Rate: number;
  hitAt3Rate: number;
  hitAt5Rate: number;
  meanReciprocalRank: number;
  rejectHitRate: number;
  meanClaimCoverage: number;
};

function normalizedUrlParts(value: string): {
  full: string;
  pathname: string;
} {
  try {
    const parsed = new URL(value);
    const pathname =
      parsed.pathname.replace(/\.mdx?$/i, "").replace(/\/+$/, "") || "/";
    return {
      full: `${parsed.origin.toLowerCase()}${pathname.toLowerCase()}`,
      pathname: pathname.toLowerCase(),
    };
  } catch {
    const normalized = value
      .trim()
      .toLowerCase()
      .replace(/\.mdx?$/i, "")
      .replace(/\/+$/, "");
    return {
      full: normalized,
      pathname: normalized.startsWith("/") ? normalized : "",
    };
  }
}

export function urlMatchesExpected(url: string, patterns: string[]): boolean {
  const candidate = normalizedUrlParts(url);
  return patterns.some((pattern) => {
    const expected = normalizedUrlParts(pattern);
    if (/^https?:\/\//i.test(pattern)) return candidate.full === expected.full;
    if (pattern.startsWith("/"))
      return candidate.pathname === expected.pathname;
    return candidate.full.includes(expected.full);
  });
}

function uniqueDirectPages(chunks: KapaRetrievedChunk[]): string[] {
  const pages: string[] = [];
  const seen = new Set<string>();
  for (const chunk of chunks) {
    if (chunk.retrievalKind === "expanded") continue;
    if (!chunk.url || seen.has(chunk.url)) continue;
    seen.add(chunk.url);
    pages.push(chunk.url);
  }
  return pages;
}

const CLAIM_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "to",
  "with",
]);

function meaningfulTokens(value: string): string[] {
  return [
    ...new Set(
      value
        .toLowerCase()
        .replace(/[^a-z0-9_$.-]+/g, " ")
        .split(/\s+/)
        .map((token) => token.replace(/^[.-]+|[.-]+$/g, ""))
        .filter((token) => token.length > 1 && !CLAIM_STOP_WORDS.has(token))
    ),
  ];
}

export function claimIsCovered(claim: string, context: string): boolean {
  const tokens = meaningfulTokens(claim);
  if (tokens.length === 0) return false;
  const contextTokens = new Set(meaningfulTokens(context));
  const matches = tokens.filter((token) => contextTokens.has(token)).length;
  return matches / tokens.length >= 0.65;
}

export function scoreRetrievedCase(input: {
  testCase: RetrievalGoldenCase;
  chunks: KapaRetrievedChunk[];
  relaxedPassUsed: boolean;
  weakEvidenceUsed: boolean;
  pageFilterUsed: boolean;
  elapsedMs: number;
  droppedPages?: Array<{ url: string; title: string; reason: string }>;
}): RetrievalEvalCaseResult {
  const pages = uniqueDirectPages(input.chunks);
  const expectedRank = pages.findIndex((url) =>
    urlMatchesExpected(url, input.testCase.expectUrls)
  );
  const rejectRank = pages.findIndex((url) =>
    urlMatchesExpected(url, input.testCase.rejectUrls)
  );
  const context = input.chunks.map((chunk) => chunk.text).join("\n");
  const claimsCovered = input.testCase.requiredClaims.filter((claim) =>
    claimIsCovered(claim, context)
  ).length;

  return {
    id: input.testCase.id,
    question: input.testCase.question,
    category: input.testCase.category,
    difficulty: input.testCase.difficulty,
    metrics: {
      hitAt1: expectedRank === 0,
      hitAt3: expectedRank >= 0 && expectedRank < 3,
      hitAt5: expectedRank >= 0 && expectedRank < 5,
      reciprocalRank: expectedRank >= 0 ? 1 / (expectedRank + 1) : 0,
      rejectHit:
        rejectRank >= 0 &&
        (expectedRank >= 0 ? rejectRank < expectedRank : rejectRank < 3),
      claimCoverage:
        input.testCase.requiredClaims.length > 0
          ? claimsCovered / input.testCase.requiredClaims.length
          : 0,
      claimsCovered,
      claimsTotal: input.testCase.requiredClaims.length,
      relaxedPassUsed: input.relaxedPassUsed,
      weakEvidenceUsed: input.weakEvidenceUsed,
      pageFilterUsed: input.pageFilterUsed,
      elapsedMs: input.elapsedMs,
    },
    topChunks: input.chunks.slice(0, 10).map((chunk) => ({
      url: chunk.url,
      title: chunk.title,
      score: chunk.score,
      retrievalKind: chunk.retrievalKind === "expanded" ? "expanded" : "direct",
    })),
    droppedPages: input.droppedPages ?? [],
  };
}

export function aggregateRetrievalResults(
  results: RetrievalEvalCaseResult[]
): RetrievalEvalAggregate {
  const count = results.length;
  const mean = (values: number[]) =>
    count > 0 ? values.reduce((sum, value) => sum + value, 0) / count : 0;
  return {
    cases: count,
    hitAt1Rate: mean(results.map((result) => Number(result.metrics.hitAt1))),
    hitAt3Rate: mean(results.map((result) => Number(result.metrics.hitAt3))),
    hitAt5Rate: mean(results.map((result) => Number(result.metrics.hitAt5))),
    meanReciprocalRank: mean(
      results.map((result) => result.metrics.reciprocalRank)
    ),
    rejectHitRate: mean(
      results.map((result) => Number(result.metrics.rejectHit))
    ),
    meanClaimCoverage: mean(
      results.map((result) => result.metrics.claimCoverage)
    ),
  };
}

function aggregateBy(
  results: RetrievalEvalCaseResult[],
  key: (result: RetrievalEvalCaseResult) => string
): Record<string, RetrievalEvalAggregate> {
  const grouped = new Map<string, RetrievalEvalCaseResult[]>();
  for (const result of results) {
    const value = key(result);
    grouped.set(value, [...(grouped.get(value) ?? []), result]);
  }
  return Object.fromEntries(
    [...grouped.entries()].map(([value, rows]) => [
      value,
      aggregateRetrievalResults(rows),
    ])
  );
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>
): Promise<R[]> {
  const output = new Array<R>(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from(
      { length: Math.min(concurrency, Math.max(items.length, 1)) },
      async () => {
        while (cursor < items.length) {
          const index = cursor++;
          output[index] = await mapper(items[index]!);
        }
      }
    )
  );
  return output;
}

export async function evaluateRetrievalCases(
  cases: RetrievalGoldenCase[],
  settings: RetrievalEvalSettings
) {
  const results = await mapWithConcurrency(
    cases,
    settings.concurrency,
    async (testCase) => {
      const started = performance.now();
      const retrieval = await retrieveWithStructuredRewriteInContext(
        {
          sourceId: settings.sourceId,
          question: testCase.question,
          expandPages: settings.expandPages,
        },
        {
          sourceScope: settings.scope,
          sourceHosting: settings.hosting,
          retrievalStrictness: settings.strictness,
        }
      );
      const scored = scoreRetrievedCase({
        testCase,
        chunks: retrieval.chunks,
        relaxedPassUsed: retrieval.relaxedPassUsed,
        weakEvidenceUsed: retrieval.weakEvidenceUsed,
        pageFilterUsed: retrieval.pageFilterUsed ?? false,
        elapsedMs: Math.round(performance.now() - started),
        droppedPages: retrieval.droppedPages,
      });
      if (settings.profile === "fast") return scored;
      const context = retrieval.chunks
        .slice(0, 10)
        .map((chunk) => chunk.text);
      const retrievalScores = await scoreRetrievalContext({
        question: testCase.question,
        groundTruth: testCase.groundTruth,
        context,
        model: settings.scorerModel ?? "openai/gpt-5.6-luna",
      });
      const answer = await generateRagAnswer({
        question: testCase.question,
        chunks: retrieval.chunks,
      });
      return {
        ...scored,
        retrievalScores,
        answer: {
          ...answer,
          scores: await scoreGeneratedAnswer({
            question: testCase.question,
            answer: answer.text,
            groundTruth: testCase.groundTruth,
            context,
            model: settings.scorerModel ?? "openai/gpt-5.6-luna",
            includeHallucination: settings.profile === "full",
          }),
        },
      };
    }
  );
  const retrievalScoreRows = results.flatMap((result) =>
    result.retrievalScores ? [result.retrievalScores] : []
  );
  const answerScoreRows = results.flatMap((result) =>
    result.answer ? [result.answer.scores] : []
  );
  const mean = <T>(rows: T[], pick: (row: T) => number): number =>
    rows.length > 0
      ? rows.reduce((sum, row) => sum + pick(row), 0) / rows.length
      : 0;
  const hallucinationRows = answerScoreRows.flatMap((scores) =>
    scores.hallucination ? [scores.hallucination.score] : []
  );

  return {
    generatedAt: new Date().toISOString(),
    sourceId: settings.sourceId,
    settings: {
      scope: settings.scope,
      hosting: settings.hosting,
      strictness: settings.strictness,
      expandPages: settings.expandPages,
      profile: settings.profile,
      scorerModel: settings.scorerModel ?? "openai/gpt-5.6-luna",
    },
    aggregate: aggregateRetrievalResults(results),
    ...(retrievalScoreRows.length > 0
      ? {
          retrievalScoreAggregate: {
            cases: retrievalScoreRows.length,
            meanPrecision: mean(
              retrievalScoreRows,
              (scores) => scores.precision.score
            ),
            meanRecall: mean(
              retrievalScoreRows,
              (scores) => scores.recall.score
            ),
            meanRelevance: mean(
              retrievalScoreRows,
              (scores) => scores.relevance.score
            ),
          },
        }
      : {}),
    ...(answerScoreRows.length > 0
      ? {
          answerScoreAggregate: {
            cases: answerScoreRows.length,
            meanFaithfulness: mean(
              answerScoreRows,
              (scores) => scores.faithfulness.score
            ),
            meanRelevancy: mean(
              answerScoreRows,
              (scores) => scores.relevancy.score
            ),
            meanSimilarity: mean(
              answerScoreRows,
              (scores) => scores.similarity.score
            ),
            ...(hallucinationRows.length > 0
              ? {
                  meanHallucination:
                    hallucinationRows.reduce((sum, score) => sum + score, 0) /
                    hallucinationRows.length,
                }
              : {}),
          },
        }
      : {}),
    byCategory: aggregateBy(results, (result) => result.category),
    byDifficulty: aggregateBy(results, (result) => result.difficulty),
    cases: results,
  };
}
