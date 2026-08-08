import * as esbuild from 'esbuild'
import { validateNodeSource } from './node-codegen'

export type ValidationError = {
  file: string
  line?: number
  col?: number
  message: string
  code?: string
}

export type ValidateFlowNodeResult = {
  valid: boolean
  errors: ValidationError[]
}

function parseEsbuildError(message: string, file: string): ValidationError[] {
  const match = message.match(/\((\d+):(\d+)\):\s*(.+)$/m)
  if (match) {
    return [
      {
        file,
        line: Number(match[1]),
        col: Number(match[2]),
        message: match[3]?.trim() ?? message,
        code: 'esbuild'
      }
    ]
  }
  return [{ file, message, code: 'esbuild' }]
}

export function validateFlowNodeSource(
  relativePath: string,
  source: string,
  task?: { nodeId: string; spec: string }
): ValidateFlowNodeResult {
  const contract = validateNodeSource(source, task)
  if (!contract.ok) {
    return {
      valid: false,
      errors: [{ file: relativePath, message: contract.reason, code: 'contract' }]
    }
  }

  try {
    esbuild.transformSync(source, {
      loader: 'ts',
      format: 'esm',
      target: 'es2022'
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { valid: false, errors: parseEsbuildError(message, relativePath) }
  }

  return { valid: true, errors: [] }
}
