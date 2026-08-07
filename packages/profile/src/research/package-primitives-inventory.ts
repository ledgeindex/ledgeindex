import { z } from "zod";
import { citationSchema, researchPrioritySchema } from "./research-lenses.js";

/** Step 1: discover primitive names (no code examples yet). */
export const packagePrimitivesInventorySchema = z.object({
  primitives: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      priority: researchPrioritySchema,
      primitiveOrApi: z.string().optional(),
      citation: citationSchema.optional(),
    }),
  ),
  notes: z.string().optional(),
});

export type PackagePrimitivesInventory = z.infer<
  typeof packagePrimitivesInventorySchema
>;

export const PACKAGE_PRIMITIVES_INVENTORY_PICK_MESSAGE =
  "Select introduction, overview, core concepts, and API summary pages that list the package's primary building blocks (functions, methods, CLI commands, or named primitives). Prefer docs home, /introduction, /first-steps, /basics, /concepts, /api overview. Prefer 3–8 pages. SKIP long tutorials, marketing, and business case studies.";

export const PACKAGE_PRIMITIVES_INVENTORY_SYNTH_INSTRUCTIONS = `Use ONLY the provided page excerpts. Do not invent facts.

INVENTORY ONLY — list primitives; do NOT include code examples or long how-tos.

1. List 2–6 **main** primitives: flagship APIs/moves the docs position as first-class pillars. Tag priority: "main".
2. List up to 5 **top** secondary primitives. Tag priority: "top".
3. Add **supporting** only when clearly documented — keep total ≤ 12. Tag priority: "supporting".

Each item: name, short description, priority (required), optional primitiveOrApi, optional citation from overview pages.
Order: main, then top, then supporting. Deduplicate. No business/ICP outcomes.`;

/** Step 2: code / usage examples for one primitive. */
export const packagePrimitiveExamplesSchema = z.object({
  howToHint: z.string().optional(),
  /** Primary code sample (fenced-block body only, no markdown fences). */
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
  suggestedTemplateTitle: z.string().optional(),
  citation: citationSchema,
});

export type PackagePrimitiveExamples = z.infer<
  typeof packagePrimitiveExamplesSchema
>;

export function buildPrimitiveExamplesPickMessage(input: {
  name: string;
  primitiveOrApi?: string;
}): string {
  const api = input.primitiveOrApi?.trim();
  const apiPart = api ? ` (${api})` : "";
  return `Select documentation pages with CODE EXAMPLES or tutorials for the "${input.name}"${apiPart} primitive — API reference with samples, guides, and recipes focused on this move. Prefer pages with copy-pasteable code. Prefer 2–8 pages.`;
}

export const PACKAGE_PRIMITIVE_EXAMPLES_SYNTH_INSTRUCTIONS = `Use ONLY the provided page excerpts. Do not invent APIs or code.

Extract USAGE EXAMPLES for ONE package primitive (named in the user message).

Required:
- usageExample: the best single code sample from the pages (TypeScript/JavaScript preferred if both exist). Body only — no markdown code fences.
- citation: URL from sources; quote a short line if helpful.

Optional:
- howToHint: 1–2 sentences on when/how to use this primitive
- usageExamples: up to 3 items if multiple distinct snippets exist — each with optional title, optional language (typescript, javascript, …), and code body without fences
- suggestedTemplateTitle: catalog-ready Package Library template name

Copy code faithfully from docs; only trim whitespace. Do not fabricate imports or APIs not shown in sources.`;
