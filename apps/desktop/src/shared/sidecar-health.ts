export type SidecarStatus = 'idle' | 'extracting' | 'starting' | 'ready' | 'error'

export type SidecarHealth = {
  status: SidecarStatus
  managedStatus: SidecarStatus
  reachable: boolean
  origin: string
  port: number
  /** 0–100 while extracting; null when unknown / N/A */
  setupProgress?: number | null
  setupMessage?: string | null
  /** Last worker start failure (packaged builds). */
  lastError?: string | null
}
