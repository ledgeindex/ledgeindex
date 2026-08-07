import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { AsyncLocalStorage } from "node:async_hooks";

export type McpAuthContext = {
  userId: string;
  email?: string;
  idToken: string;
  authInfo?: AuthInfo;
};

const storage = new AsyncLocalStorage<McpAuthContext>();

export function runWithMcpAuth<T>(ctx: McpAuthContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

export function getMcpAuthContext(): McpAuthContext | undefined {
  return storage.getStore();
}

/** Propagate MCP auth through Fastify's async request chain. */
export function enterMcpAuthContext(ctx: McpAuthContext): void {
  storage.enterWith(ctx);
}
