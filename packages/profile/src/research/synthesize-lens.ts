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

function extractJsonObject(text: string | undefined): unknown {
  const trimmed = text?.trim();
  if (!trimmed) return undefined;
  try {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start < 0 || end <= start) return undefined;
    return JSON.parse(trimmed.slice(start, end + 1)) as unknown;
  } catch {
    return undefined;
  }
}

async function generateStructuredObject(input: {
  agent: Agent;
  prompt: string;
  schema: import("zod").ZodType<unknown>;
}): Promise<{ object: unknown; text?: string }> {
  try {
    const result = await input.agent.generate(input.prompt, {
      maxSteps: 1,
      structuredOutput: {
        schema: input.schema,
        jsonPromptInjection: true,
      },
    } as never);
    return {
      object:
        (result as { object?: unknown }).object ??
        extractJsonObject((result as { text?: string }).text),
      text: (result as { text?: string }).text,
    };
  } catch {
    // One retry without provider structured-output enforcement.
    const retry = await input.agent.generate(
      `${input.prompt}

Return ONLY one JSON object matching the schema. Every required key must be present.`,
      { maxSteps: 1 } as never,
    );
    return {
      object: extractJsonObject((retry as { text?: string }).text),
      text: (retry as { text?: string }).text,
    };
  }
}

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

  const { object: rawObject } = await generateStructuredObject({
    agent,
    prompt,
    schema: definition.schema,
  });

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
    data: parsed.data as LensOutputById[L],
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

  const { object: rawObject } = await generateStructuredObject({
    agent,
    prompt,
    schema: input.schema,
  });

  const parsed = input.schema.safeParse(rawObject);
  if (!parsed.success) {
    throw new Error(
      `Structured output failed for "${input.id}": ${parsed.error.message}`,
    );
  }

  return { modelId, sourceUrls, data: parsed.data };
}
