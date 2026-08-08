import type { Agent } from "@mastra/core/agent";
import type { ZodTypeAny } from "zod";
import type { z as zod } from "zod";

type StructuredGenerateOptions = {
  maxSteps: number;
  structuredOutput: {
    schema: ZodTypeAny;
    jsonPromptInjection: "auto";
  };
};

/**
 * Mastra `agent.generate` + Zod 4 structured output hits TS2589; runtime contract is unchanged.
 */
export async function agentStructuredOutput<T extends ZodTypeAny>(
  agent: Agent,
  prompt: string,
  schema: T,
): Promise<zod.infer<T> | null> {
  const options: StructuredGenerateOptions = {
    maxSteps: 1,
    structuredOutput: {
      schema,
      jsonPromptInjection: "auto",
    },
  };

  const result = await agent.generate(prompt, options as never);
  const parsed = schema.safeParse(result.object);
  return parsed.success ? parsed.data : null;
}
