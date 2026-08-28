import { Agent } from "@mastra/core/agent";
import type { KapaRetrievedChunk } from "../../../retrieval/kapa-retrieve.js";
import { getGeneratorModel } from "../../../llm/models.js";
import { mastraModelIdLabel } from "../../../llm/mastra-model.js";

export type GeneratedRagAnswer = {
  text: string;
  model: string;
  contextChunkCount: number;
};

export async function generateRagAnswer(input: {
  question: string;
  chunks: KapaRetrievedChunk[];
}): Promise<GeneratedRagAnswer> {
  const model = getGeneratorModel();
  const context = input.chunks.slice(0, 10);
  const agent = new Agent({
    id: "retrieval-eval-answer-generator",
    name: "Retrieval evaluation answer generator",
    instructions: `Answer documentation questions using only the supplied context.
If the context is insufficient, say so instead of guessing.
Keep the answer concise and include source URLs for factual claims.`,
    model,
  });
  const prompt = [
    `Question: ${input.question}`,
    "Retrieved context:",
    ...context.map(
      (chunk, index) =>
        `[${index + 1}] ${chunk.title}\nURL: ${chunk.url}\n${chunk.text}`,
    ),
  ].join("\n\n");
  const result = await agent.generate(prompt, {
    maxSteps: 1,
    modelSettings: { temperature: 0 },
  });
  return {
    text: result.text.trim(),
    model: mastraModelIdLabel(model),
    contextChunkCount: context.length,
  };
}
