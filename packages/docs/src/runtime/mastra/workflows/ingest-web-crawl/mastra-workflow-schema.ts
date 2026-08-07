import type { ZodTypeAny } from "zod";

/**
 * Mastra workflow `createStep` + Zod 4 can recurse deeply in TS; return type preserves inference.
 */
export function mastraWorkflowSchema<T extends ZodTypeAny>(schema: T): T {
  return schema;
}
