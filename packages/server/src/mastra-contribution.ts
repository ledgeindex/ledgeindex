import { Mastra } from "@mastra/core/mastra";
import type { MastraServer } from "@mastra/fastify";
import { MastraServer as MastraServerImpl } from "@mastra/fastify";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { MastraContribution } from "@ledgeindex/core";
import { logInfo } from "@ledgeindex/docs/runtime/lib/logger.js";
import {
  getMcpHttpPath,
  getMcpInternalHttpPath,
  getMcpTransportPathPrefix,
  LEDGEINDEX_MCP_SERVER_ID,
  MASTRA_API_PREFIX,
  MCP_PUBLIC_HTTP_PATH,
} from "@ledgeindex/docs/runtime/mastra/mcp/config.js";

export type { MastraContribution };

export type MergeMastraOptions = {
  contributions: MastraContribution[];
};

type McpHttpServer = {
  startHTTP: (args: {
    url: URL;
    httpPath: string;
    req: unknown;
    res: unknown;
    options?: { serverless?: boolean };
  }) => Promise<void>;
  startSSE?: (args: {
    url: URL;
    ssePath: string;
    messagePath: string;
    req: unknown;
    res: unknown;
  }) => Promise<void>;
};

export function mergeMastraContributions(options: MergeMastraOptions): Mastra {
  const agents: Record<string, unknown> = {};
  const workflows: Record<string, unknown> = {};
  const vectors: Record<string, unknown> = {};
  const mcpServers: Record<string, unknown> = {};
  const apiRoutes: unknown[] = [];
  const middleware: unknown[] = [];

  let storage: unknown;
  let logger: unknown;
  let observability: unknown;
  let mcpOptions: unknown;

  for (const contribution of options.contributions) {
    if (contribution.agents) {
      for (const [key, agent] of Object.entries(contribution.agents)) {
        if (agents[key]) {
          throw new Error(
            `Duplicate Mastra agent id "${key}" from profile "${contribution.id}"`,
          );
        }
        agents[key] = agent;
      }
    }
    if (contribution.workflows) {
      for (const [key, workflow] of Object.entries(contribution.workflows)) {
        if (workflows[key]) {
          throw new Error(
            `Duplicate Mastra workflow id "${key}" from profile "${contribution.id}"`,
          );
        }
        workflows[key] = workflow;
      }
    }
    if (contribution.vectors) {
      Object.assign(vectors, contribution.vectors);
    }
    if (contribution.mcpServers) {
      for (const [key, server] of Object.entries(contribution.mcpServers)) {
        if (mcpServers[key]) {
          throw new Error(
            `Duplicate Mastra MCP server id "${key}" from profile "${contribution.id}"`,
          );
        }
        mcpServers[key] = server;
      }
    }
    if (contribution.storage && !storage) {
      storage = contribution.storage;
    }
    if (contribution.logger && !logger) {
      logger = contribution.logger;
    }
    if (contribution.observability && !observability) {
      observability = contribution.observability;
    }
    if (contribution.server?.mcpOptions && !mcpOptions) {
      mcpOptions = contribution.server.mcpOptions;
    }
    if (contribution.server?.middleware) {
      middleware.push(...contribution.server.middleware);
    }
    if (contribution.server?.apiRoutes) {
      apiRoutes.push(...contribution.server.apiRoutes);
    }
  }

  if (!storage) {
    throw new Error("mergeMastraContributions: at least one profile must provide storage");
  }

  return new Mastra({
    agents,
    workflows,
    vectors,
    mcpServers,
    storage,
    logger,
    observability,
    server: {
      mcpOptions,
      middleware,
      apiRoutes,
    },
  } as ConstructorParameters<typeof Mastra>[0]);
}

function resolvePublicMcpServer(mastra: Mastra): McpHttpServer | null {
  const byId = mastra.getMCPServerById(LEDGEINDEX_MCP_SERVER_ID) as
    | McpHttpServer
    | undefined;
  if (byId) return byId;
  const servers = mastra.listMCPServers?.();
  if (!servers || typeof servers !== "object") return null;
  const values = Object.values(servers as Record<string, McpHttpServer>);
  return values[0] ?? null;
}

/**
 * Short public MCP endpoints (`/mcp`) that call MCPServer.startHTTP/startSSE
 * with a matching httpPath — avoids Mastra's nested `/mastra/mcp/:id/mcp` URL.
 */
function registerPublicMcpAlias(app: FastifyInstance, mastra: Mastra): void {
  const publicHttp = getMcpHttpPath();
  const publicSse = `${MCP_PUBLIC_HTTP_PATH}/sse`;
  const publicMessages = `${MCP_PUBLIC_HTTP_PATH}/messages`;

  const runHttp = async (request: FastifyRequest, reply: FastifyReply) => {
    const server = resolvePublicMcpServer(mastra);
    if (!server?.startHTTP) {
      return reply.code(503).send({ error: "MCP server unavailable" });
    }
    reply.hijack();
    const rawReq = request.raw as typeof request.raw & { body?: unknown };
    if (request.body !== undefined) {
      rawReq.body = request.body;
    }
    const host = request.headers.host ?? "localhost";
    await server.startHTTP({
      // Pathname must equal httpPath — MCPServer 404s otherwise.
      url: new URL(publicHttp, `http://${host}`),
      httpPath: publicHttp,
      req: request.raw,
      res: reply.raw,
      options: { serverless: true },
    });
  };

  for (const method of ["GET", "POST", "PUT", "DELETE", "PATCH"] as const) {
    app.route({
      method,
      url: publicHttp,
      handler: runHttp,
    });
  }

  app.route({
    method: "GET",
    url: publicSse,
    handler: async (request, reply) => {
      const server = resolvePublicMcpServer(mastra);
      if (!server?.startSSE) {
        return reply.code(404).send({ error: "MCP SSE not available" });
      }
      reply.hijack();
      const host = request.headers.host ?? "localhost";
      await server.startSSE({
        url: new URL(request.url, `http://${host}`),
        ssePath: publicSse,
        messagePath: publicMessages,
        req: request.raw,
        res: reply.raw,
      });
    },
  });

  app.route({
    method: "POST",
    url: publicMessages,
    handler: async (request, reply) => {
      const server = resolvePublicMcpServer(mastra);
      if (!server?.startSSE) {
        return reply.code(404).send({ error: "MCP SSE not available" });
      }
      reply.hijack();
      const rawReq = request.raw as typeof request.raw & { body?: unknown };
      if (request.body !== undefined) {
        rawReq.body = request.body;
      }
      const host = request.headers.host ?? "localhost";
      await server.startSSE({
        url: new URL(request.url, `http://${host}`),
        ssePath: publicSse,
        messagePath: publicMessages,
        req: request.raw,
        res: reply.raw,
      });
    },
  });
}

export async function mountMastraOnFastify(
  app: FastifyInstance,
  mastra: Mastra,
): Promise<MastraServer> {
  const mcpPrefix = getMcpTransportPathPrefix();
  const publicHttp = getMcpHttpPath();
  const internalHttp = getMcpInternalHttpPath();
  const mastraServer = new MastraServerImpl({
    app,
    mastra,
    prefix: MASTRA_API_PREFIX,
    mcpOptions: { serverless: true },
    customRouteAuthConfig: new Map([
      [`ALL:${publicHttp}`, false],
      [`ALL:${publicHttp}/sse`, false],
      [`ALL:${publicHttp}/messages`, false],
      [`ALL:${internalHttp}`, false],
      [`ALL:${mcpPrefix}sse`, false],
      [`ALL:${mcpPrefix}messages`, false],
    ]),
  });
  await mastraServer.init();
  registerPublicMcpAlias(app, mastra);
  logInfo(
    `Mastra server mounted at ${MASTRA_API_PREFIX} (public MCP ${publicHttp})`,
    "Server",
  );
  return mastraServer;
}
