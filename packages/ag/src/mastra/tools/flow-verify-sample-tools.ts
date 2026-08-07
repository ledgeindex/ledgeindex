import { createTool } from '@mastra/core/tools'
import { existsSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { z } from 'zod'
import { flowPackageDir } from '../../lib/flow-package-paths'

function packagePathFromContext(requestContext: unknown): string | null {
  const ctx = requestContext as {
    get?: (key: string) => unknown
  } | null
  const direct = ctx?.get?.('flowPackagePath')
  if (typeof direct === 'string' && direct.trim()) return direct.trim()
  const flowId = ctx?.get?.('flow_id')
  if (typeof flowId === 'string' && flowId.trim()) return flowPackageDir(flowId.trim())
  return null
}

/**
 * Read last dry-run / verify output samples written under verify-samples/.
 * Lets the package healer inspect what each node actually returned.
 */
export const readVerifySamplesTool = createTool({
  id: 'read_verify_samples',
  description:
    'List or read verify-samples/{nodeId}.json from the last dry-run. Use to see what each node output before editing. Pass nodeId to read one sample, or omit to list available sample files.',
  inputSchema: z.object({
    nodeId: z
      .string()
      .optional()
      .describe('Node id to read (e.g. phase-03). Omit to list all sample files.')
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    samplesDir: z.string().optional(),
    files: z.array(z.string()).optional(),
    nodeId: z.string().optional(),
    content: z.string().optional(),
    error: z.string().optional()
  }),
  execute: async (input, context) => {
    const base = packagePathFromContext(context?.requestContext)
    if (!base) {
      return { ok: false, error: 'flowPackagePath / flow_id missing from requestContext' }
    }
    const samplesDir = join(base, 'verify-samples')
    if (!existsSync(samplesDir)) {
      return {
        ok: false,
        samplesDir,
        error: 'No verify-samples yet — no dry-run samples on disk'
      }
    }

    if (!input.nodeId?.trim()) {
      const files = readdirSync(samplesDir).filter((name) => name.endsWith('.json'))
      return { ok: true, samplesDir, files }
    }

    const nodeId = input.nodeId.trim()
    const path = join(samplesDir, `${nodeId}.json`)
    if (!existsSync(path)) {
      const files = readdirSync(samplesDir).filter((name) => name.endsWith('.json'))
      return {
        ok: false,
        samplesDir,
        files,
        nodeId,
        error: `No sample for ${nodeId}`
      }
    }

    const raw = readFileSync(path, 'utf8')
    const content = raw.length > 6000 ? `${raw.slice(0, 6000)}\n…(truncated)` : raw
    return { ok: true, samplesDir, nodeId, content }
  }
})
