function formatData(data?: Record<string, unknown>): string {
  if (!data || Object.keys(data).length === 0) return ''
  try {
    return ` ${JSON.stringify(data)}`
  } catch {
    return ''
  }
}

function isVerbose(): boolean {
  return process.env.AG_VERBOSE === 'true' || process.env.MASTRA_VERBOSE === 'true'
}

/** Structured logs for the Mastra engine process (stdout → `[mastra]` prefix when sidecar-spawned). */
export function agLogInfo(context: string, message: string, data?: Record<string, unknown>): void {
  console.log(`[ag:${context}] ${message}${formatData(data)}`)
}

export function agLogVerbose(context: string, message: string, data?: Record<string, unknown>): void {
  if (!isVerbose()) return
  console.log(`[ag:${context}:verbose] ${message}${formatData(data)}`)
}

export function agLogError(context: string, message: string, error?: unknown): void {
  const extra =
    error instanceof Error ? error.message : error !== undefined && error !== null ? String(error) : ''
  console.error(`[ag:${context}] ${message}${extra ? ` — ${extra}` : ''}`)
}

export function agLogSummary(context: string, message: string, data?: Record<string, unknown>): void {
  console.log(`[ag:${context}:summary] ${message}${formatData(data)}`)
}
