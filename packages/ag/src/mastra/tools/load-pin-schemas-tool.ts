import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import {
  AUTOMATIONGHOST_PIN_TYPES_V1,
  type AutomationGhostPinTypeV1
} from '../../lib/automationghost-pin-types'
import { loadPinSchemas } from '../../lib/pin-schema-lookup'

const MAX_TYPES_PER_CALL = 10

const pinTypeEnum = z.enum(
  AUTOMATIONGHOST_PIN_TYPES_V1 as unknown as [
    AutomationGhostPinTypeV1,
    ...AutomationGhostPinTypeV1[]
  ]
)

/**
 * Pindown-style multi-type schema loader.
 * Prefer deterministic inject in codegen; this tool is for agents that need on-demand load.
 */
export const loadPinSchemasTool = createTool({
  id: 'load_pin_schemas',
  description: `Load pin_config JSON Schemas for one or more pin types in a single call.

WORKFLOW:
1. Call with every pin_type you will emit (e.g. ["markdown", "table", "stat-cards"]).
2. Use returned jsonSchema + example to build { pinType, pin_config } artifacts.
3. Re-call if you need more types later.

Does not mutate data. Safe to call multiple times.`,
  inputSchema: z.object({
    pin_types: z
      .array(pinTypeEnum)
      .min(1)
      .max(MAX_TYPES_PER_CALL)
      .describe('Pin type ids to load (e.g. markdown, table, stat-cards).')
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    schemas: z.array(
      z.object({
        pin_type: z.string(),
        jsonSchema: z.unknown().nullable(),
        example: z.unknown().nullable(),
        hints: z.string()
      })
    )
  }),
  execute: async ({ pin_types }) => ({
    ok: true,
    schemas: loadPinSchemas(pin_types)
  })
})
