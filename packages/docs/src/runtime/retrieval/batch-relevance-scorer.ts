import { Agent } from "@mastra/core/agent";
import type { QueryResult } from "@mastra/core/vector";
import type { RerankResult } from "@mastra/rag";
import { logVerbose, logWarn } from "../lib/logger.js";
import { getPrunerModel } from "../llm/models.js";
import { SEARCH_TOP_K } from "../vector/constants.js";
import { combineWeightedRerankScores } from "./weighted-rerank.js";

function parseBatchScores(
  text: string,
  expectedCount: number,
): Map<number, number> {
  const scores = new Map<number, number>();
  const trimmed = text.trim();
  const jsonStart = trimmed.indexOf("{");
  const jsonEnd = trimmed.lastIndexOf("}");
  if (jsonStart === -1 || jsonEnd === -1) {
    throw new Error("Batch pruner response did not contain JSON");
  }

  const payload = JSON.parse(trimmed.slice(jsonStart, jsonEnd + 1)) as {
    scores?: Array<{ index?: number; score?: number }>;
  };

  for (const entry of payload.scores ?? []) {
    const index = Number(entry.index);
    const score = Number(entry.score);
    if (
      Number.isInteger(index) &&
      index >= 0 &&
      index < expectedCount &&
      Number.isFinite(score)
    ) {
      scores.set(index, Math.min(1, Math.max(0, score)));
    }
  }

  if (scores.size === 0) {
    throw new Error("Batch pruner returned no valid scores");
  }

  return scores;
}

const BATCH_PRUNER_INSTRUCTIONS = `You are a relevance grader for RAG retrieval.

Given a user query and numbered text passages, score how well each passage answers the query.

Rules:
- Output ONLY valid JSON, no markdown fences or explanation.
- Format: {"scores":[{"index":0,"score":0.85},{"index":1,"score":0.12}]}
- One object per passage index (0-based), in any order.
- Each score is a number from 0.0 (irrelevant) to 1.0 (perfect match).`;

let batchPrunerAgent: Agent | null = null;

function getBatchPrunerAgent(): Agent {
  if (!batchPrunerAgent) {
    batchPrunerAgent = new Agent({
      id: "ledgeindex-batch-pruner",
      name: "LedgeIndex Batch Pruner",
      instructions: BATCH_PRUNER_INSTRUCTIONS,
      model: getPrunerModel(),
    });
  }
  return batchPrunerAgent;
}

/**
 * Score all candidate chunks in a single LLM request (Kapa pruner stage).
 * Mastra's MastraAgentRelevanceScorer calls the model once per chunk (~20 requests);
 * this batches into one request while keeping semantic + vector + position reranking.
 */
export async function batchLlmRerank(input: {
  query: string;
  results: QueryResult[];
  queryVector?: number[];
  topK?: number;
}): Promise<RerankResult[]> {
  const { query, results, topK = SEARCH_TOP_K } = input;
  if (results.length === 0) return [];

  const passages = results.map((result, index) => {
    const text = String(result.metadata?.text ?? "").slice(0, 2000);
    return { index, text };
  });

  const agent = getBatchPrunerAgent();
  const prompt = [
    `Query: ${query}`,
    "",
    "Passages:",
    JSON.stringify(passages),
  ].join("\n");

  let semanticByIndex = new Map<number, number>();

  try {
    const response = await agent.generate(prompt);
    semanticByIndex = parseBatchScores(response.text ?? "", results.length);
    logVerbose("Batch LLM rerank scored passages", "BatchPruner", {
      queryLength: query.length,
      passageCount: results.length,
      scoredCount: semanticByIndex.size,
    });
  } catch (error) {
    logWarn(
      error instanceof Error ? error.message : "Batch pruner failed",
      "BatchPruner",
      { passageCount: results.length },
    );
    // Fall back to vector-only semantic component on parse / API failure.
    semanticByIndex = new Map(
      results.map((result, index) => [index, result.score ?? 0]),
    );
  }

  return combineWeightedRerankScores({
    results,
    semanticByIndex,
    topK,
  });
}
