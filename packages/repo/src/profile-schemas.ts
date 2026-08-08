import { z } from "zod";
import { exampleKindSchema } from "@ledgeindex/core/enrich";

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

export const repoPrimitiveKindSchema = z.enum([
  "export",
  "class",
  "function",
  "type",
  "config",
  "cli",
  "other",
]);

export const repoPrimitiveSchema = z.object({
  name: z.string().min(1).describe("Symbol, export, or command name"),
  kind: repoPrimitiveKindSchema,
  description: z.string().min(1).describe("What this primitive does"),
  importFrom: z
    .string()
    .nullable()
    .optional()
    .describe("Package/module import path when known"),
  sourcePath: z
    .string()
    .nullable()
    .optional()
    .describe("Relative file path where this was found"),
});

export const repoProfileExampleSchema = z.object({
  kind: exampleKindSchema,
  title: z.string().min(1),
  description: z.string().min(1),
  language: languageSchema,
  body: z.string().min(1).describe("Code or config copied from the repo"),
  sourcePath: z
    .string()
    .nullable()
    .optional()
    .describe("Relative path, e.g. README.md#Usage"),
});

/** Pass 1 structured output: what the repo is + core primitives. */
export const repoProfileCoreSchema = z.object({
  libraryName: z.string().min(1),
  description: z
    .string()
    .min(1)
    .describe("2–4 sentences: what this repository is and who it is for"),
  summary: z
    .string()
    .min(1)
    .describe("One-line summary suitable for a card subtitle"),
  primitives: z
    .array(repoPrimitiveSchema)
    .max(16)
    .describe("Main APIs / exports / entry points found in the repo"),
  filesConsulted: z.array(z.string()).describe("Paths actually read"),
});

/** Pass 2 structured output: usage / setup examples only. */
export const repoProfileExamplesSchema = z.object({
  examples: z
    .array(repoProfileExampleSchema)
    .max(8)
    .describe("Grounded usage/setup/code examples from README/examples/tests"),
});

export const repoProfileSchema = z.object({
  libraryName: z.string(),
  description: z.string(),
  summary: z.string(),
  primitives: z.array(repoPrimitiveSchema),
  examples: z.array(repoProfileExampleSchema),
  filesConsulted: z.array(z.string()),
  profiledAt: z.string().datetime().optional(),
});

export type RepoPrimitive = z.infer<typeof repoPrimitiveSchema>;
export type RepoProfileExample = z.infer<typeof repoProfileExampleSchema>;
export type RepoProfileCore = z.infer<typeof repoProfileCoreSchema>;
export type RepoProfile = z.infer<typeof repoProfileSchema>;
