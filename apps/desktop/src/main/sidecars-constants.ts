/** Desktop-only API port (web/AG keep 3010). */
export const DESKTOP_SERVER_PORT = Number(
  process.env.LEDGEINDEX_DESKTOP_SERVER_PORT?.trim() || 3015
)

export const LOG_PREFIX = 'ledgeindex-runtime'
