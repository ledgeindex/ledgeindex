import { Agent } from "@mastra/core/agent";
import {
  resolveChatModelConfig,
  resolveDefaultProfileModelId,
} from "@ledgeindex/core/llm/chat-model-config.js";
import type { FetchedPage } from "./fetch-picked-pages.js";

const SYNTH_INSTRUCTIONS = `You answer the user's question using ONLY the provided page excerpts.

- Match the question: short direct answers for yes/no or simple checks; more detail only if the user asked for details, lists, or explanations.
- Do not invent facts. If sources are insufficient, say so.
- Mention which source URLs support your answer when helpful.`;

export type SynthesizeAnswerResult = {
  query: string;
  modelId: string;
  answer: string;
  sourceUrls: string[];
};

export async function synthesizeAnswer(
  query: string,
  fetched: FetchedPage[],
  options?: { modelId?: string },
): Promise<SynthesizeAnswerResult> {
  const trimmed = query.trim();
  if (!trimmed) throw new Error("query is required");

  const usable = fetched.filter((p) => p.markdown.length > 0 && !p.error);
  const sourceUrls = usable.map((p) => p.url);
  const modelId = options?.modelId?.trim() || (await resolveDefaultProfileModelId());

  if (usable.length === 0) {
    return {
      query: trimmed,
      modelId,
      answer: "Could not read any of the picked pages.",
      sourceUrls: [],
    };
  }

  const model = resolveChatModelConfig(modelId);
  const agent = new Agent({
    id: "company-research-synth",
    name: "Company Research Synthesizer",
    instructions: SYNTH_INSTRUCTIONS,
    model,
  });

  const sourcesBlock = usable
    .map(
      (p, i) =>
        `### Source ${i + 1}: ${p.title}\nURL: ${p.url}\n\n${p.markdown}`,
    )
    .join("\n\n---\n\n");

  const prompt = `User question: ${trimmed}\n\n${sourcesBlock}`;

  const result = await agent.generate(prompt, { maxSteps: 1 });
  const answer = result.text?.trim() || "No answer produced.";

  return {
    query: trimmed,
    modelId,
    answer,
    sourceUrls,
  };
}
