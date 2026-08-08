import { z } from 'zod'

export const nodeCodegenTaskSchema = z.object({
  nodeId: z.string(),
  label: z.string(),
  spec: z.string(),
  phase: z.object({
    phase: z.string(),
    title: z.string(),
    spec: z.string(),
    plan: z.string(),
    outputShape: z.string().optional(),
    dependencies: z.array(z.string().min(1)).optional(),
    branches: z
      .array(
        z.object({
          id: z.string(),
          title: z.string(),
          spec: z.string(),
          plan: z.string(),
          dependencies: z.array(z.string().min(1)).optional()
        })
      )
      .optional()
  })
})

export const codegenNodeResultSchema = z.object({
  nodeId: z.string(),
  source: z.string(),
  fromAgent: z.boolean(),
  warning: z.string().optional()
})
