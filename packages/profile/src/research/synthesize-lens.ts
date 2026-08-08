import { Agent } from "@mastra/core/agent";
import type { FetchedPage } from "./fetch-picked-pages.js";
import {
  getLensDefinition,
  type LensOutputById,
  type ResearchLens,
} from "./research-lenses.js";
import type { ProfileModelSelection } from "./profile-model.js";
import { resolveProfileStepModel } from "./profile-model.js";

export type SynthesizeLensResult<L extends ResearchLens = ResearchLens> = {
  lens: L;
  modelId: string;
  sourceUrls: string[];
  data: LensOutputById[L];
};

export async function synthesizeLens<L extends ResearchLens>(
  lens: L,
  fetched: FetchedPage[],
  options?: { modelId?: string; model?: ProfileModelSelection | null },
): Promise<SynthesizeLensResult<L>> {
  const definition = getLensDefinition(lens);
  const usable = fetched.filter((p) => p.markdown.length > 0 && !p.error);
  const sourceUrls = usable.map((p) => p.url);
  const { model, modelId } = await resolveProfileStepModel({
    modelId: options?.modelId,
    model: options?.model,
  });

  if (usable.length === 0) {
    throw new Error(`No readable pages to synthesize lens "${lens}"`);
  }

  const agent = new Agent({
    id: `company-research-synth-${lens}`,
    name: `Company Research — ${definition.label}`,
    instructions: definition.synthInstructions,
    model,
  });

  const sourcesBlock = usable
    .map(
      (p, i) =>
        `### Source ${i + 1}: ${p.title}\nURL: ${p.url}\n\n${p.markdown}`,
    )
    .join("\n\n---\n\n");

  const prompt = `Research lens: ${definition.label} (${lens})\n\n${sourcesBlock}`;

  const result = await agent.generate(prompt, {
    maxSteps: 1,
    structuredOutput: {
      schema: definition.schema,
      // Prefer prompt injection so local / weaker models still return JSON
      // instead of relying on provider-native structured output only.
      jsonPromptInjection: true,
    },
  } as never);

  const rawObject =
    result.object ??
    (() => {
      const text = result.text?.trim();
      if (!text) return undefined;
      try {
        const start = text.indexOf("{");
        const end = text.lastIndexOf("}");
        if (start < 0 || end <= start) return undefined;
        return JSON.parse(text.slice(start, end + 1)) as unknown;
      } catch {
        return undefined;
      }
    })();

  const parsed = definition.schema.safeParse(rawObject);
  if (!parsed.success) {
    throw new Error(
      `Lens "${lens}" structured output failed: ${parsed.error.message}`,
    );
  }

  return {
    lens,
    modelId,
    sourceUrls,
    data: parsed.data,
  };
}

export async function synthesizeStructured<T>(input: {
  id: string;
  label: string;
  instructions: string;
  schema: import("zod").ZodType<T>;
  fetched: FetchedPage[];
  userPromptPrefix?: string;
  modelId?: string;
  model?: ProfileModelSelection | null;
}): Promise<{ modelId: string; sourceUrls: string[]; data: T }> {
  const usable = input.fetched.filter((p) => p.markdown.length > 0 && !p.error);
  const sourceUrls = usable.map((p) => p.url);
  const { model, modelId } = await resolveProfileStepModel({
    modelId: input.modelId,
    model: input.model,
  });

  if (usable.length === 0) {
    throw new Error(`No readable pages to synthesize "${input.id}"`);
  }

  const agent = new Agent({
    id: `company-research-synth-${input.id}`,
    name: input.label,
    instructions: input.instructions,
    model,
  });

  const sourcesBlock = usable
    .map(
      (p, i) =>
        `### Source ${i + 1}: ${p.title}\nURL: ${p.url}\n\n${p.markdown}`,
    )
    .join("\n\n---\n\n");

  const prompt = `${input.userPromptPrefix ? `${input.userPromptPrefix}\n\n` : ""}${sourcesBlock}`;

  const result = await agent.generate(prompt, {
    maxSteps: 1,
    structuredOutput: {
      schema: input.schema,
      jsonPromptInjection: true,
    },
  } as never);

  const rawObject =
    result.object ??
    (() => {
      const text = result.text?.trim();
      if (!text) return undefined;
      try {
        const start = text.indexOf("{");
        const end = text.lastIndexOf("}");
        if (start < 0 || end <= start) return undefined;
        return JSON.parse(text.slice(start, end + 1)) as unknown;
      } catch {
        return undefined;
      }
    })();

  const parsed = input.schema.safeParse(rawObject);
  if (!parsed.success) {
    throw new Error(
      `Structured output failed for "${input.id}": ${parsed.error.message}`,
    );
  }

  return { modelId, sourceUrls, data: parsed.data };
}
