import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import { registerProfile } from "@ledgeindex/profile";
import { registerDocsProfile, createDocsMastraContribution } from "@ledgeindex/docs";
import { setMastraInstance } from "@ledgeindex/docs/runtime/mastra/instance.js";
import { LEDGEINDEX_CORE_VERSION } from "@ledgeindex/core";
import { registerAgProfile } from "@ledgeindex/ag";
import {
  mergeMastraContributions,
  mountMastraOnFastify,
  type MastraContribution,
} from "./mastra-contribution.js";
import { registerLedgeIndexRateLimit } from "./rate-limit/plugin.js";
import { LEDGEINDEX_API_RATE_LIMIT } from "./rate-limit/default-config.js";
import {
  API_MAJOR_VERSION,
  formatRateLimitHeader,
  formatRateLimitPolicyHeader,
  stripV1Prefix,
} from "./http/api-conventions.js";

export const LEDGEINDEX_SERVER_VERSION = "0.1.0" as const;

export type LedgeIndexProfile = "docs" | "profile" | "ag";

export type LedgeIndexServerOptions = {
  dataDir?: string;
  profiles?: LedgeIndexProfile[];
  port?: number;
  host?: string;
  /** Required when `ag` is in profiles (wired by ag-server / AutomationGhost host). */
  createAgMastraContribution?: () => MastraContribution;
  /** Extra plugins (Firebase auth, OAuth, logging) — hosted entry only */
  beforeProfiles?: (app: FastifyInstance) => Promise<void>;
  afterProfiles?: (app: FastifyInstance) => Promise<void>;
};

/** Normalize legacy `company` profile id → `profile`. */
function normalizeProfiles(profiles: string[]): LedgeIndexProfile[] {
  return profiles.map((p) => (p === "company" ? "profile" : p)) as LedgeIndexProfile[];
}

export type LedgeIndexServer = {
  app: FastifyInstance;
  listen: () => Promise<void>;
};

async function buildMastraContributions(
  profiles: LedgeIndexProfile[],
  createAgMastraContribution?: () => MastraContribution,
): Promise<MastraContribution[]> {
  const contributions: MastraContribution[] = [];

  if (profiles.includes("docs")) {
    contributions.push(createDocsMastraContribution());
  }

  if (profiles.includes("ag")) {
    if (!createAgMastraContribution) {
      throw new Error(
        "@ledgeindex/server: ag profile requires createAgMastraContribution in server options",
      );
    }
    contributions.push(createAgMastraContribution());
  }

  return contributions;
}

export async function createLedgeIndexServer(
  options: LedgeIndexServerOptions = {},
): Promise<LedgeIndexServer> {
  const profiles = normalizeProfiles(options.profiles ?? ["docs", "profile"]);
  if (options.dataDir) {
    process.env.LEDGEINDEX_DATA_DIR = options.dataDir;
  }

  const app = Fastify({
    logger: false,
    // Chat attachments (images / PDF page rasters) travel as base64 in JSON.
    bodyLimit: 32 * 1024 * 1024,
    rewriteUrl: (req) => stripV1Prefix(req.url ?? "/"),
  });

  await app.register(cors, {
    origin: true,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "ApiKey",
      "API-Version",
      "MCP-Protocol-Version",
      "Mcp-Method",
      "Mcp-Name",
    ],
    exposedHeaders: [
      "RateLimit",
      "RateLimit-Policy",
      "Retry-After",
      "API-Version",
      "Deprecation",
      "Sunset",
    ],
  });

  const rateWindow = LEDGEINDEX_API_RATE_LIMIT.windowSeconds;
  app.addHook("onSend", async (request, reply, payload) => {
    if (!reply.hasHeader("API-Version")) {
      reply.header("API-Version", API_MAJOR_VERSION);
    }
    const isRead =
      request.method === "GET" ||
      request.method === "HEAD" ||
      request.method === "OPTIONS";
    const limit = isRead
      ? LEDGEINDEX_API_RATE_LIMIT.fallback.readMaxPerWindow
      : LEDGEINDEX_API_RATE_LIMIT.fallback.writeMaxPerWindow;
    if (!reply.hasHeader("RateLimit")) {
      reply.header(
        "RateLimit",
        formatRateLimitHeader({
          limit,
          remaining: limit,
          resetSeconds: rateWindow,
        }),
      );
    }
    if (!reply.hasHeader("RateLimit-Policy")) {
      reply.header(
        "RateLimit-Policy",
        formatRateLimitPolicyHeader({ limit, windowSeconds: rateWindow }),
      );
    }
    if (reply.statusCode === 429 && !reply.hasHeader("Retry-After")) {
      reply.header("Retry-After", String(rateWindow));
    }
    return payload;
  });

  // Same pattern as backend-api legacy scopes: @fastify/rate-limit + onRoute
  // injection. Must register before profile routes so hooks attach.
  await registerLedgeIndexRateLimit(app);

  if (options.beforeProfiles) {
    await options.beforeProfiles(app);
  }

  const mastraProfiles = profiles.filter((p) => p === "docs" || p === "ag");
  if (mastraProfiles.length > 0) {
    const contributions = await buildMastraContributions(
      mastraProfiles,
      options.createAgMastraContribution,
    );
    const mastra = mergeMastraContributions({ contributions });
    setMastraInstance(mastra);
    await mountMastraOnFastify(app, mastra);
  }

  if (profiles.includes("docs")) {
    await registerDocsProfile(app);
  }

  if (profiles.includes("profile")) {
    await registerProfile(app);
  }

  if (profiles.includes("ag")) {
    await registerAgProfile(app);
  }

  if (options.afterProfiles) {
    await options.afterProfiles(app);
  }

  app.get("/health/packages", async () => ({
    "@ledgeindex/core": LEDGEINDEX_CORE_VERSION,
    "@ledgeindex/server": LEDGEINDEX_SERVER_VERSION,
    profiles,
  }));

  const port = options.port ?? Number.parseInt(process.env.PORT ?? "3010", 10);
  const host = options.host ?? process.env.HOST ?? "0.0.0.0";

  return {
    app,
    listen: async () => {
      await app.listen({ port, host });
    },
  };
}

export async function startLedgeIndexServer(
  options: LedgeIndexServerOptions = {},
): Promise<LedgeIndexServer> {
  const server = await createLedgeIndexServer(options);
  await server.listen();
  return server;
}

export {
  mergeMastraContributions,
  mountMastraOnFastify,
  type MastraContribution,
} from "./mastra-contribution.js";
