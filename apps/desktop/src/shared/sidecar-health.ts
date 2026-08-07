export type SidecarStatus = 'idle' | 'starting' | 'ready' | 'error'

export type SidecarHealth = {
  status: SidecarStatus
  managedStatus: SidecarStatus
  reachable: boolean
  origin: string
  port: number
}
