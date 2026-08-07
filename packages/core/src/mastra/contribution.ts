/** Profile slice merged into one process-level Mastra instance (open-core contract). */
export type MastraContribution = {
  id: string;
  agents?: Record<string, unknown>;
  workflows?: Record<string, unknown>;
  vectors?: Record<string, unknown>;
  mcpServers?: Record<string, unknown>;
  storage?: unknown;
  logger?: unknown;
  observability?: unknown;
  server?: {
    mcpOptions?: unknown;
    middleware?: unknown[];
    apiRoutes?: unknown[];
  };
};
