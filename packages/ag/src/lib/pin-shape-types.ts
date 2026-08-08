import { z } from 'zod'

export const pinShapeUpdateTargetSchema = z.object({
  pinId: z.string().min(1),
  pinType: z.string().min(1),
  label: z.string().optional(),
  title: z.string().optional(),
  pin_config: z.record(z.string(), z.unknown()).optional()
})

export const pinShapeRequestSchema = z.object({
  flowId: z.string().min(1),
  mode: z.enum(['create', 'update']),
  upstream: z.unknown(),
  userInstructions: z.string().optional(),
  pinTypes: z.array(z.string().min(1)).optional(),
  updateTargets: z.array(pinShapeUpdateTargetSchema).optional(),
  model: z.string().min(3).optional(),
  lmStudioBaseUrl: z.string().min(1).optional(),
  lmStudioModelId: z.string().min(1).optional()
})

export type PinShapeRequest = z.infer<typeof pinShapeRequestSchema>

export type PinShapeArtifact = {
  pinId: string
  pinType: string
  title?: string
  pin_config: Record<string, unknown>
}

export type PinShapeResponse = {
  ok: boolean
  pins: PinShapeArtifact[]
  error?: string
  toolErrors?: string[]
}
