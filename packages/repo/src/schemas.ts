import { z } from "zod";

/** Models sometimes return language as ["ts","js"] — coerce to one string or null. */
const languageSchema = z.preprocess((value) => {
  if (value == null) return null;
  if (Array.isArray(value)) {
    const first = value.find((v) => typeof v === "string" && v.trim());
    return first ?? null;
  }
  if (typeof value === "string") return value;
  return null;
}, z.string().nullable());

const mainUsageExampleSchema = z.object({
  title: z.string().min(1).describe("Short title for the main usage example"),
  description: z
    .string()
    .min(1)
    .describe("One sentence describing what the example shows"),
  language: languageSchema.describe("Code language, e.g. javascript / typescript"),
  body: z
    .string()
    .min(1)
    .describe("The main usage code snippet, copied from the repo (not invented)"),
  source_path: z
    .string()
    .nullable()
    .optional()
    .describe("Relative file path, e.g. README.md#Usage"),
});

/** Structured explore result: one primary usage example. */
export const repoExploreOutputSchema = z.object({
  page_summary: z
    .string()
    .describe("Short summary of what this library is / does"),
  library_name: z.string().describe("Package or repo name"),
  files_consulted: z
    .array(z.string())
    .describe("Relative paths the agent actually read"),
  main_usage_example: mainUsageExampleSchema
    .nullable()
    .describe(
      "The single primary usage example from README/docs/examples. null only if none exists.",
    ),
});

export type RepoExploreOutput = z.infer<typeof repoExploreOutputSchema>;
export type RepoMainUsageExample = z.infer<typeof mainUsageExampleSchema>;
