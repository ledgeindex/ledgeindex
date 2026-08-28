export type RetrievalContextScores = {
  precision: { score: number; reason: string };
  recall: { score: number; reason: string };
  relevance: { score: number; reason: string };
};

export type AnswerQualityScores = {
  faithfulness: { score: number; reason: string };
  relevancy: { score: number; reason: string };
  similarity: { score: number; reason: string };
  hallucination?: { score: number; reason: string };
};

function scoreResult(result: { score: number; reason?: string }): {
  score: number;
  reason: string;
} {
  return {
    score: result.score,
    reason: result.reason ?? "",
  };
}

export async function scoreRetrievalContext(input: {
  question: string;
  groundTruth: string;
  context: string[];
  model: string;
}): Promise<RetrievalContextScores> {
  const {
    createContextPrecisionScorer,
    createContextRecallScorer,
    createContextRelevanceScorerLLM,
  } = await import("@mastra/evals/scorers/prebuilt");
  const options = { context: input.context.slice(0, 10), scale: 1 };
  const run = {
    input: input.question,
    output: input.groundTruth,
    groundTruth: input.groundTruth,
  };
  const [precision, recall, relevance] = await Promise.all([
    createContextPrecisionScorer({ model: input.model, options }).run(run),
    createContextRecallScorer({ model: input.model, options }).run(run),
    createContextRelevanceScorerLLM({ model: input.model, options }).run(run),
  ]);
  return {
    precision: scoreResult(precision),
    recall: scoreResult(recall),
    relevance: scoreResult(relevance),
  };
}

export async function scoreGeneratedAnswer(input: {
  question: string;
  answer: string;
  groundTruth: string;
  context: string[];
  model: string;
  includeHallucination: boolean;
}): Promise<AnswerQualityScores> {
  const {
    createAnswerRelevancyScorer,
    createAnswerSimilarityScorer,
    createFaithfulnessScorer,
    createHallucinationScorer,
  } = await import("@mastra/evals/scorers/prebuilt");
  const options = { context: input.context.slice(0, 10), scale: 1 };
  const run = {
    input: input.question,
    output: input.answer,
    groundTruth: input.groundTruth,
  };
  const [faithfulness, relevancy, similarity] = await Promise.all([
      createFaithfulnessScorer({ model: input.model, options }).run(run),
      createAnswerRelevancyScorer({ model: input.model }).run(run),
      createAnswerSimilarityScorer({
        model: input.model,
        options: { requireGroundTruth: true },
      }).run(run),
    ]);
  const hallucination = input.includeHallucination
    ? await createHallucinationScorer({
        model: input.model,
        options,
      }).run(run)
    : undefined;
  return {
    faithfulness: scoreResult(faithfulness),
    relevancy: scoreResult(relevancy),
    similarity: scoreResult(similarity),
    ...(hallucination
      ? { hallucination: scoreResult(hallucination) }
      : {}),
  };
}
