import type {
  FastifyInstance,
  FastifyPluginAsync,
  FastifyRequest,
  RouteOptions,
} from "fastify";
import rateLimit from "@fastify/rate-limit";
import fp from "fastify-plugin";
import { LEDGEINDEX_API_RATE_LIMIT } from "./default-config.js";
import { createRateLimitResolver } from "./resolve.js";
import type { RateLimitConfig } from "./types.js";

const DEFAULT_PREFIXES = ["/api", "/chat", "/mastra"];

function envFlagOff(raw: string | undefined): boolean {
  const value = raw?.trim().toLowerCase();
  return value === "0" || value === "false" || value === "off" || value === "no";
}

function resolveRateLimitKey(
  request: FastifyRequest,
  resolver: ReturnType<typeof createRateLimitResolver>,
): string {
  const path = request.raw.url?.split("?")[0] ?? "";
  const res = resolver.resolve(request.method, path);
  const bucket = res?.bucketId ?? "unscoped";
  const uid = request.user?.uid;
  if (uid) return `${uid}:ledgeindex:${bucket}`;
  return `ip:${request.ip}:ledgeindex:${bucket}`;
}

export type RegisterRateLimitOptions = {
  config?: RateLimitConfig;
  routePrefixes?: string | string[];
};

/**
 * Pindown-style `@fastify/rate-limit`: register once, inject `preHandler` via
 * `onRoute` for `/api`, `/chat`, `/mastra`. Health / oauth stay unlimited.
 *
 * Disable with `LEDGEINDEX_RATE_LIMIT=0`.
 */
const rateLimitPlugin: FastifyPluginAsync<RegisterRateLimitOptions> = async (
  fastify,
  options,
) => {
  if (envFlagOff(process.env.LEDGEINDEX_RATE_LIMIT)) {
    return;
  }

  const config = options.config ?? LEDGEINDEX_API_RATE_LIMIT;
  const prefixes = options.routePrefixes ?? DEFAULT_PREFIXES;
  const prefixList = (Array.isArray(prefixes) ? prefixes : [prefixes]).map(
    (p) => (p.endsWith("/") ? p.slice(0, -1) : p),
  );
  const resolver = createRateLimitResolver(prefixList, config);

  await fastify.register(rateLimit, {
    global: false,
    hook: "preHandler",
  });

  fastify.addHook("onRoute", (routeOptions: RouteOptions) => {
    const url = routeOptions.url;
    if (typeof url !== "string") return;
    if (!prefixList.some((p) => url === p || url.startsWith(`${p}/`))) return;

    const existing = routeOptions.preHandler;
    const chain = Array.isArray(existing)
      ? [...existing]
      : existing
        ? [existing]
        : [];

    const rlPreHandler = fastify.rateLimit({
      timeWindow: resolver.windowMs(),
      keyGenerator: (request: FastifyRequest) =>
        resolveRateLimitKey(request, resolver),
      max: async (request: FastifyRequest) => {
        const path = request.raw.url?.split("?")[0] ?? "";
        const res = resolver.resolve(request.method, path);
        if (res) return res.maxPerWindow;
        const isRead =
          request.method === "GET" ||
          request.method === "HEAD" ||
          request.method === "OPTIONS";
        return isRead
          ? config.fallback.readMaxPerWindow
          : config.fallback.writeMaxPerWindow;
      },
      errorResponseBuilder: (_request, context) => ({
        statusCode: 429,
        error: {
          code: "RATE_LIMITED",
          type: "rate_limit",
          message: `Too many requests. Retry after ${context.after}.`,
        },
      }),
    });

    chain.push(rlPreHandler);
    routeOptions.preHandler = chain.length === 1 ? chain[0] : chain;
  });
};

export const registerRateLimit = fp(rateLimitPlugin, {
  name: "ledgeindex-rate-limit",
});

export async function registerLedgeIndexRateLimit(
  app: FastifyInstance,
  options?: RegisterRateLimitOptions,
): Promise<void> {
  await app.register(registerRateLimit, options ?? {});
}
