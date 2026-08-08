import { z } from "zod";
import { citationSchema, researchPrioritySchema } from "./research-lenses.js";

/** Step 1: catalog guides/tutorials (no code bodies yet). */
export const packageUsageExamplesInventorySchema = z.object({
  examples: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      priority: researchPrioritySchema,
      kind: z.string().optional(),
      primitivesUsed: z.array(z.string()).optional(),
      suggestedExampleTitle: z.string().optional(),
      citation: citationSchema,
    }),
  ),
  notes: z.string().optional(),
});

export type PackageUsageExamplesInventory = z.infer<
  typeof packageUsageExamplesInventorySchema
>;

export const PACKAGE_USAGE_EXAMPLES_INVENTORY_PICK_MESSAGE =
  "Select pages with CONCRETE GUIDES and EXAMPLES — quickstarts, tutorials, recipes, templates, sample projects, cookbooks, and worked scenarios. Prefer /examples, /guides, /tutorials, /recipes, /templates, /cookbook, /quickstart and docs first-steps hubs. Prefer 4–10 pages. SKIP API reference-only leaf pages and pure marketing. Bias to pages that represent copy-pasteable guides.";

export const PACKAGE_USAGE_EXAMPLES_INVENTORY_SYNTH_INSTRUCTIONS = `Use ONLY the provided page excerpts. Do not invent facts.

INVENTORY ONLY — list guides and example scenarios; do NOT include code blocks or full page markdown.

1. List 2–4 **main** examples: flagship tutorials/quickstarts the docs promote. Tag priority: "main".
2. List up to 3–5 **top** examples. Tag priority: "top".
3. Add **supporting** only when clearly useful — keep total ≤ 10. Tag priority: "supporting".

Each item: name, description, priority (required), optional kind (quickstart, guide, tutorial, recipe, template, example), optional primitivesUsed, optional suggestedExampleTitle, citation.
Order: main, then top, then supporting. Deduplicate. This is NOT a primitive/API inventory.`;

/** Step 2: code samples for one guide/example. */
export const packageGuideCodeExamplesSchema = z.object({
  usageExample: z.string(),
  usageExamples: z
    .array(
      z.object({
        title: z.string().optional(),
        language: z.string().optional(),
        code: z.string(),
      }),
    )
    .optional(),
  citation: citationSchema,
});

export type PackageGuideCodeExamples = z.infer<typeof packageGuideCodeExamplesSchema>;

export function buildGuideExamplesPickMessage(input: {
  name: string;
  kind?: string;
}): string {
  const kind = input.kind?.trim();
  const kindPart = kind ? ` (${kind})` : "";
  return `Select documentation pages with CODE for the guide or tutorial "${input.name}"${kindPart} — the tutorial itself, recipes, and pages with copy-pasteable samples for this scenario. Prefer 2–8 pages with fenced code blocks.`;
}

export const PACKAGE_GUIDE_CODE_EXAMPLES_SYNTH_INSTRUCTIONS = `Use ONLY the provided page excerpts. Do not invent code.

Extract CODE EXAMPLES for ONE guide/tutorial (named in the user message).

Required:
- usageExample: the best primary code sample from the pages. Body only — no markdown code fences.
- citation: URL from sources; quote a short line if helpful.

Optional:
- usageExamples: up to 4 distinct snippets — each with optional title, optional language (typescript, javascript, python, bash, …), code body without fences

Copy code faithfully from docs; only trim whitespace. Prefer TypeScript/JavaScript when multiple languages appear.`;
