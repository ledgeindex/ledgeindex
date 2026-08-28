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

function envFlagOn(raw: string | undefined): boolean {
  const value = raw?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "on" || value === "yes";
}

function envFlagOff(raw: string | undefined): boolean {
  const value = raw?.trim().toLowerCase();
  return value === "0" || value === "false" || value === "off" || value === "no";
}

/** Off in local dev unless `LEDGEINDEX_RATE_LIMIT=1`. On in production unless `=0`. */
function isRateLimitEnabled(): boolean {
  const raw = process.env.LEDGEINDEX_RATE_LIMIT;
  if (envFlagOff(raw)) return false;
  if (envFlagOn(raw)) return true;
  return process.env.NODE_ENV === "production";
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
 * Disable with `LEDGEINDEX_RATE_LIMIT=0`. Force on locally with `=1`.
 * Default: enabled in production only (`NODE_ENV=production`).
 */
const rateLimitPlugin: FastifyPluginAsync<RegisterRateLimitOptions> = async (
  fastify,
  options,
) => {
  if (!isRateLimitEnabled()) {
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
    enableDraftSpec: true,
    addHeadersOnExceeding: {
      "ratelimit-limit": true,
      "ratelimit-remaining": true,
      "ratelimit-reset": true,
    },
    addHeaders: {
      "ratelimit-limit": true,
      "ratelimit-remaining": true,
      "ratelimit-reset": true,
      "retry-after": true,
    },
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
      errorResponseBuilder: (_request, context) => {
        const after = String(context.after);
        const retrySeconds = Number.parseInt(after, 10);
        return {
          type: "https://ledgeindex.com/problems/rate-limited",
          title: "Too Many Requests",
          status: 429,
          detail: `Too many requests. Retry after ${after}.`,
          code: "RATE_LIMITED",
          error: `Too many requests. Retry after ${after}.`,
          retryAfter: Number.isFinite(retrySeconds) ? retrySeconds : after,
        };
      },
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
