import { z } from "zod";

export const retrievalGoldenCaseSchema = z.object({
  id: z.string().min(1),
  question: z.string().min(1),
  category: z.string().min(1),
  difficulty: z.enum(["easy", "medium", "hard"]),
  expectUrls: z.array(z.string().min(1)).min(1),
  rejectUrls: z.array(z.string()).default([]),
  requiredClaims: z.array(z.string().min(1)).min(1),
  groundTruth: z.string().min(1),
  tags: z.array(z.string()).default([]),
  sourceUrls: z.array(z.string().url()).min(1),
});

export type RetrievalGoldenCase = z.infer<typeof retrievalGoldenCaseSchema>;

export const generateGoldenSetInputSchema = z.object({
  sourceId: z.string().min(1),
  count: z.number().int().min(5).max(100).default(50),
});

export const generatedGoldenSetSchema = z.object({
  schemaVersion: z.literal(1),
  name: z.string(),
  sourceId: z.string(),
  sourceSlug: z.string(),
  strictness: z.literal("strict"),
  hosting: z.enum(["local", "cloud"]),
  scope: z.enum(["personal", "global"]),
  reviewStatus: z.literal("draft"),
  corpusPin: z.object({
    exportedAt: z.string(),
    sourceVersionNumber: z.number(),
    sourceIndexedAt: z.string().nullable(),
    pageHashes: z.record(z.string(), z.string()),
  }),
  cases: z.array(retrievalGoldenCaseSchema),
});

export const retrievalEvalInputSchema = z.object({
  sourceId: z.string().min(1),
  scope: z.enum(["personal", "global"]).default("personal"),
  hosting: z.enum(["local", "cloud"]).default("local"),
  strictness: z.enum(["strict", "balanced", "permissive"]).default("strict"),
  expandPages: z.boolean().default(true),
  concurrency: z.number().int().min(1).max(8).default(2),
  profile: z.enum(["fast", "pr", "full"]).default("fast"),
  scorerModel: z.string().min(1).default("openai/gpt-5.6-luna"),
  cases: z.array(retrievalGoldenCaseSchema).min(1).max(250),
});

const scoredChunkSchema = z.object({
  url: z.string(),
  title: z.string(),
  score: z.number(),
  retrievalKind: z.enum(["direct", "expanded"]),
});

const caseMetricsSchema = z.object({
  hitAt1: z.boolean(),
  hitAt3: z.boolean(),
  hitAt5: z.boolean(),
  reciprocalRank: z.number(),
  rejectHit: z.boolean(),
  claimCoverage: z.number(),
  claimsCovered: z.number().int(),
  claimsTotal: z.number().int(),
  relaxedPassUsed: z.boolean(),
  weakEvidenceUsed: z.boolean(),
  pageFilterUsed: z.boolean(),
  elapsedMs: z.number(),
});

const semanticScoreSchema = z.object({
  score: z.number(),
  reason: z.string(),
});

export const retrievalEvalCaseResultSchema = z.object({
  id: z.string(),
  question: z.string(),
  category: z.string(),
  difficulty: z.enum(["easy", "medium", "hard"]),
  metrics: caseMetricsSchema,
  retrievalScores: z
    .object({
      precision: semanticScoreSchema,
      recall: semanticScoreSchema,
      relevance: semanticScoreSchema,
    })
    .optional(),
  answer: z
    .object({
      text: z.string(),
      model: z.string(),
      contextChunkCount: z.number().int(),
      scores: z.object({
        faithfulness: semanticScoreSchema,
        relevancy: semanticScoreSchema,
        similarity: semanticScoreSchema,
        hallucination: semanticScoreSchema.optional(),
      }),
    })
    .optional(),
  topChunks: z.array(scoredChunkSchema),
  droppedPages: z.array(
    z.object({
      url: z.string(),
      title: z.string(),
      reason: z.string(),
    })
  ),
});

const aggregateSliceSchema = z.object({
  cases: z.number().int(),
  hitAt1Rate: z.number(),
  hitAt3Rate: z.number(),
  hitAt5Rate: z.number(),
  meanReciprocalRank: z.number(),
  rejectHitRate: z.number(),
  meanClaimCoverage: z.number(),
});

export const retrievalEvalOutputSchema = z.object({
  generatedAt: z.string(),
  sourceId: z.string(),
  settings: z.object({
    scope: z.enum(["personal", "global"]),
    hosting: z.enum(["local", "cloud"]),
    strictness: z.enum(["strict", "balanced", "permissive"]),
    expandPages: z.boolean(),
    profile: z.enum(["fast", "pr", "full"]),
    scorerModel: z.string(),
  }),
  aggregate: aggregateSliceSchema,
  retrievalScoreAggregate: z
    .object({
      cases: z.number().int(),
      meanPrecision: z.number(),
      meanRecall: z.number(),
      meanRelevance: z.number(),
    })
    .optional(),
  answerScoreAggregate: z
    .object({
      cases: z.number().int(),
      meanFaithfulness: z.number(),
      meanRelevancy: z.number(),
      meanSimilarity: z.number(),
      meanHallucination: z.number().optional(),
    })
    .optional(),
  byCategory: z.record(z.string(), aggregateSliceSchema),
  byDifficulty: z.record(z.string(), aggregateSliceSchema),
  cases: z.array(retrievalEvalCaseResultSchema),
});
