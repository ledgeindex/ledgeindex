import { z } from 'zod'

export const FLOW_VERSION = 1 as const

const positionSchema = z.object({
  x: z.number(),
  y: z.number()
})

const triggerHotkeyDataSchema = z.object({
  chord: z.string().default(''),
  enabled: z.boolean().default(true),
  label: z.string().optional()
})

const triggerScheduleDataSchema = z.object({
  cron: z.string().default('0 9 * * 1'),
  timezone: z.string().default('Europe/Berlin'),
  enabled: z.boolean().default(true),
  label: z.string().optional()
})

const triggerPaletteDataSchema = z.object({
  label: z.string().default('Run flow'),
  keywords: z.array(z.string()).optional()
})

const codeTsDataSchema = z.object({
  source: z.string().default('export default async function main($input) {\n  return $input\n}\n'),
  sourcePath: z.string().optional(),
  entry: z.literal('main').default('main')
})

const outputDataSchema = z.object({
  sink: z.enum(['clipboard', 'notification', 'log']).default('log'),
  showRunIndicator: z.boolean().default(false)
})

export const flowNodeSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  position: positionSchema,
  data: z.record(z.string(), z.unknown()).default({})
})

export const flowEdgeSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  sourceHandle: z.string().nullable().optional(),
  targetHandle: z.string().nullable().optional()
})

export const flowSettingsSchema = z
  .object({
    concurrency: z.enum(['single', 'parallel']).optional(),
    timeoutMs: z.number().int().positive().optional(),
    dependencies: z.record(z.string(), z.string()).optional(),
    autoArrangeOnSave: z.boolean().optional()
  })
  .optional()

export const flowDefinitionSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  version: z.literal(FLOW_VERSION),
  nodes: z.array(flowNodeSchema),
  edges: z.array(flowEdgeSchema),
  settings: flowSettingsSchema,
  createdAt: z.string(),
  updatedAt: z.string()
})

export type FlowNode = z.infer<typeof flowNodeSchema>
export type FlowEdge = z.infer<typeof flowEdgeSchema>
export type FlowDefinition = z.infer<typeof flowDefinitionSchema>
export type FlowSettings = z.infer<typeof flowSettingsSchema>
