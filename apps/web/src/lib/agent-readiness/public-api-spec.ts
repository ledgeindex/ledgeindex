/**
 * Public OpenAPI + MCP manifest for the website (`/openapi.json`, `/.well-known/mcp.json`).
 * Keep in sync with `packages/docs/src/runtime/openapi/public-api-spec.ts` (API server).
 * The web Docker build has no monorepo `packages/` tree, so this file lives here.
 */
export type PublicApiSpecUrls = {
  siteUrl: string;
  apiUrl: string;
};

export function defaultPublicApiSpecUrls(): PublicApiSpecUrls {
  const siteUrl =
    process.env.LEDGEINDEX_PUBLIC_SITE_URL?.trim()?.replace(/\/$/, "") ||
    "https://ledgeindex.com";
  const apiUrl =
    process.env.LEDGEINDEX_PUBLIC_API_URL?.trim()?.replace(/\/$/, "") ||
    process.env.KNOWLEDGEINDEX_PUBLIC_API_URL?.trim()?.replace(/\/$/, "") ||
    "https://api.ledgeindex.com";
  return { siteUrl, apiUrl };
}

const PROBLEM_JSON = "application/problem+json";
const JSON_CT = "application/json";

function problemRef() {
  return { $ref: "#/components/schemas/Problem" };
}

function jsonSchema(ref: string) {
  return { [JSON_CT]: { schema: { $ref: ref } } };
}

function problemContent() {
  return { [PROBLEM_JSON]: { schema: problemRef() } };
}

function rateLimitHeaders() {
  return {
    RateLimit: { $ref: "#/components/headers/RateLimit" },
    "RateLimit-Policy": { $ref: "#/components/headers/RateLimitPolicy" },
    "API-Version": { $ref: "#/components/headers/ApiVersion" },
  };
}

function errorHeaders() {
  return {
    ...rateLimitHeaders(),
    "Retry-After": { $ref: "#/components/headers/RetryAfter" },
    Deprecation: { $ref: "#/components/headers/Deprecation" },
    Sunset: { $ref: "#/components/headers/Sunset" },
  };
}

function errorResponses() {
  return {
    "400": {
      description: "Bad request",
      headers: rateLimitHeaders(),
      content: problemContent(),
    },
    "401": {
      description: "Authentication required or token invalid",
      headers: rateLimitHeaders(),
      content: problemContent(),
    },
    "403": {
      description: "Forbidden",
      headers: rateLimitHeaders(),
      content: problemContent(),
    },
    "404": {
      description: "Not found",
      headers: rateLimitHeaders(),
      content: problemContent(),
    },
    "429": {
      description: "Rate or daily message limit exceeded",
      headers: errorHeaders(),
      content: problemContent(),
    },
    "500": {
      description: "Server error",
      headers: rateLimitHeaders(),
      content: problemContent(),
    },
  };
}

export function buildPublicOpenApiSpec(urls: PublicApiSpecUrls) {
  const { siteUrl: site, apiUrl: api } = urls;
  const errors = errorResponses();

  return {
    openapi: "3.1.0",
    info: {
      title: "LedgeIndex API",
      version: "1.0.0",
      summary: "LedgeIndex REST API v1",
      description:
        "REST API for LedgeIndex — sources, ingest, chat, widget, and usage. Authenticate with a Firebase ID token (Bearer) or a live_ API key.\n\nVersioning: v1 is the current stable version. The unversioned origin and `/v1` are the same API. Breaking changes ship as `/v2`. Deprecated versions send `Deprecation` and `Sunset` (RFC 8594) before removal.\n\nErrors use RFC 9457 `application/problem+json` with a machine-readable `code` and a human-readable `detail`.\n\nRate limits: IETF `RateLimit` and `RateLimit-Policy` on responses; `Retry-After` on 429.",
      contact: {
        name: "LedgeIndex",
        url: site,
        email: "hello@ledgeindex.com",
      },
      license: {
        name: "LedgeIndex Sustainable Use 1.0",
        url: "https://github.com/ledgeindex/ledgeindex",
      },
    },
    servers: [
      { url: `${api}/v1`, description: "LedgeIndex API v1" },
      { url: api, description: "Unversioned alias of v1" },
    ],
    tags: [
      { name: "health", description: "Service health and MCP discovery" },
      { name: "sources", description: "Knowledge sources and ingest" },
      { name: "chat", description: "Grounded chat over indexed sources" },
      { name: "widget", description: "Public embeddable website widget" },
      { name: "auth", description: "Account and API keys" },
      { name: "usage", description: "Cloud usage meters" },
    ],
    "x-api-versioning": {
      strategy: "url-path",
      current: "v1",
      unversionedAlias: true,
      deprecationHeaders: ["Deprecation", "Sunset"],
    },
    paths: {
      "/health": {
        get: {
          operationId: "getHealth",
          summary: "API health and MCP discovery",
          description:
            "Returns service status, LLM readiness, and MCP transport URL with OAuth metadata when auth is enabled.",
          tags: ["health"],
          responses: {
            "200": {
              description: "Service is up",
              headers: rateLimitHeaders(),
              content: jsonSchema("#/components/schemas/HealthResponse"),
            },
            ...errors,
          },
        },
      },
      "/api/sources": {
        get: {
          operationId: "listSources",
          summary: "List indexed sources",
          description:
            "List personal or global sources visible to the authenticated user.",
          tags: ["sources"],
          security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
          parameters: [
            {
              name: "scope",
              in: "query",
              schema: { type: "string", enum: ["personal", "global"] },
            },
          ],
          responses: {
            "200": {
              description: "Source list",
              headers: rateLimitHeaders(),
              content: jsonSchema("#/components/schemas/SourceListResponse"),
            },
            ...errors,
          },
        },
        post: {
          operationId: "createSource",
          summary: "Create a web crawl source",
          description:
            "Create a source from a start URL. Returns the created source id and slug.",
          tags: ["sources"],
          security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
          requestBody: {
            required: true,
            content: {
              [JSON_CT]: {
                schema: { $ref: "#/components/schemas/CreateSourceRequest" },
              },
            },
          },
          responses: {
            "201": {
              description: "Source created",
              headers: rateLimitHeaders(),
              content: jsonSchema("#/components/schemas/CreateSourceResponse"),
            },
            ...errors,
          },
        },
      },
      "/api/sources/{sourceId}/ask": {
        post: {
          operationId: "askSource",
          summary: "Ask a question over one source",
          description:
            "Retrieval-augmented answer with citations. Counts toward daily cloud message limits on free plans.",
          tags: ["chat", "sources"],
          security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
          parameters: [
            {
              name: "sourceId",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          requestBody: {
            required: true,
            content: {
              [JSON_CT]: {
                schema: { $ref: "#/components/schemas/AskSourceRequest" },
              },
            },
          },
          responses: {
            "200": {
              description: "Answer with citations",
              headers: rateLimitHeaders(),
              content: jsonSchema("#/components/schemas/AskSourceResponse"),
            },
            ...errors,
          },
        },
      },
      "/api/widget/chat": {
        post: {
          operationId: "widgetChat",
          summary: "Public widget chat (SSE)",
          description:
            "Streaming chat for an embedded website widget. Origin allowlist enforced. Counts toward the widget owner's daily cloud message limit.",
          tags: ["widget"],
          requestBody: {
            required: true,
            content: {
              [JSON_CT]: {
                schema: { $ref: "#/components/schemas/WidgetChatRequest" },
              },
            },
          },
          responses: {
            "200": {
              description: "text/event-stream token stream",
              headers: rateLimitHeaders(),
              content: {
                "text/event-stream": {
                  schema: { type: "string" },
                },
              },
            },
            ...errors,
          },
        },
      },
      "/api/auth/me": {
        get: {
          operationId: "getAuthMe",
          summary: "Current user profile and plan limits",
          description:
            "Returns the signed-in user's role, plan, and daily cloud message usage.",
          tags: ["auth"],
          security: [{ bearerAuth: [] }],
          responses: {
            "200": {
              description: "User profile",
              headers: rateLimitHeaders(),
              content: jsonSchema("#/components/schemas/AuthMeResponse"),
            },
            ...errors,
          },
        },
      },
      "/api/usage/cloud-messages": {
        get: {
          operationId: "getCloudMessageUsage",
          summary: "Daily cloud chat usage for the signed-in user",
          description:
            "UTC-day meter for hosted cloud chat and ask. Null limit means the meter is not applied.",
          tags: ["usage"],
          security: [{ bearerAuth: [] }],
          responses: {
            "200": {
              description: "Usage meter",
              headers: rateLimitHeaders(),
              content: jsonSchema("#/components/schemas/DailyMessageUsage"),
            },
            ...errors,
          },
        },
      },
    },
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "Firebase ID token",
          description:
            "Firebase Authentication JWT from the LedgeIndex web app.",
        },
        apiKeyAuth: {
          type: "apiKey",
          in: "header",
          name: "Authorization",
          description: "Bearer live_* API key issued from the app.",
        },
        oauth2: {
          type: "oauth2",
          description:
            "OAuth 2.0 for MCP clients (PKCE). Metadata at /.well-known/oauth-authorization-server",
          flows: {
            authorizationCode: {
              authorizationUrl: `${api}/oauth/authorize`,
              tokenUrl: `${api}/oauth/token`,
              scopes: {
                "mcp:read": "Read indexed sources via MCP tools",
                "mcp:write": "Invoke MCP tools that mutate or ingest",
              },
            },
          },
        },
      },
      headers: {
        RateLimit: {
          description:
            "IETF RateLimit header: limit, remaining, and reset seconds for the current window.",
          schema: { type: "string", example: "limit=120, remaining=119, reset=58" },
        },
        RateLimitPolicy: {
          description: "IETF RateLimit-Policy quota advertisement (requests per window).",
          schema: { type: "string", example: "120;w=60" },
        },
        RetryAfter: {
          description: "Seconds to wait before retrying a 429 (RFC 9110).",
          schema: { type: "integer", minimum: 1 },
        },
        ApiVersion: {
          description: "Stable API version served for this request.",
          schema: { type: "string", example: "1" },
        },
        Deprecation: {
          description:
            "RFC 9745. Present only when this version is deprecated (boolean true or a deprecation date).",
          schema: { type: "string" },
        },
        Sunset: {
          description:
            "RFC 8594 HTTP-date when a deprecated version will be removed. Omitted on current v1.",
          schema: { type: "string" },
        },
      },
      schemas: {
        Problem: {
          type: "object",
          required: ["type", "title", "status", "detail", "code"],
          properties: {
            type: {
              type: "string",
              format: "uri",
              description: "RFC 9457 problem type URI.",
            },
            title: { type: "string" },
            status: { type: "integer" },
            detail: { type: "string" },
            instance: { type: "string" },
            code: {
              type: "string",
              description: "Machine-readable error code, e.g. UNAUTHORIZED, RATE_LIMITED.",
            },
            error: {
              type: "string",
              description: "Legacy alias of detail for existing clients.",
            },
          },
        },
        HealthResponse: {
          type: "object",
          required: ["status", "service"],
          properties: {
            status: { type: "string", example: "ok" },
            service: { type: "string", example: "ledgeindex-api" },
            timestamp: { type: "string", format: "date-time" },
            mastra: { type: "object", additionalProperties: true },
          },
        },
        SourceSummary: {
          type: "object",
          properties: {
            id: { type: "string" },
            slug: { type: "string" },
            name: { type: "string" },
            scope: { type: "string", enum: ["personal", "global"] },
          },
        },
        SourceListResponse: {
          type: "object",
          properties: {
            sources: {
              type: "array",
              items: { $ref: "#/components/schemas/SourceSummary" },
            },
          },
        },
        CreateSourceRequest: {
          type: "object",
          required: ["startUrl"],
          properties: {
            startUrl: { type: "string", format: "uri" },
            name: { type: "string" },
            scope: { type: "string", enum: ["personal", "global"] },
          },
        },
        CreateSourceResponse: {
          type: "object",
          properties: {
            id: { type: "string" },
            slug: { type: "string" },
            name: { type: "string" },
          },
        },
        AskSourceRequest: {
          type: "object",
          required: ["message"],
          properties: {
            message: { type: "string" },
            mode: { type: "string", enum: ["agent", "retrieve-only"] },
          },
        },
        AskSourceResponse: {
          type: "object",
          properties: {
            answer: { type: "string" },
            insufficient: { type: "boolean" },
            chunks: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  text: { type: "string" },
                  url: { type: "string" },
                  title: { type: "string" },
                  score: { type: "number" },
                },
              },
            },
          },
        },
        WidgetChatRequest: {
          type: "object",
          required: ["websiteId", "message"],
          properties: {
            websiteId: { type: "string" },
            message: { type: "string" },
            sourceId: { type: "string" },
          },
        },
        AuthMeResponse: {
          type: "object",
          properties: {
            role: { type: "string" },
            plan: { type: "string", enum: ["free", "pro"] },
            planLimitsEnabled: { type: "boolean" },
            dailyMessages: { $ref: "#/components/schemas/DailyMessageUsage" },
          },
        },
        DailyMessageUsage: {
          type: "object",
          properties: {
            apply: { type: "boolean" },
            limit: { type: ["integer", "null"] },
            used: { type: "integer" },
            remaining: { type: ["integer", "null"] },
            resetsAt: { type: "string", format: "date-time" },
            cloudOnly: { type: "boolean" },
          },
        },
      },
    },
    "x-mcp": {
      transport: `${api}/mcp`,
      protocolVersion: "2025-03-26",
      oauthAuthorizationServer: `${api}/.well-known/oauth-authorization-server`,
      oauthProtectedResource: `${api}/.well-known/oauth-protected-resource`,
      scopes: ["mcp:read", "mcp:write"],
    },
  };
}

export function buildPublicMcpManifest(urls: PublicApiSpecUrls) {
  const { siteUrl: site, apiUrl: api } = urls;
  return {
    name: "LedgeIndex MCP",
    description:
      "Model Context Protocol server exposing LedgeIndex indexed sources as tools for AI agents.",
    version: "1.0.0",
    protocolVersion: "2025-03-26",
    serverInfo: {
      name: "LedgeIndex",
      version: "1.0.0",
      description:
        "Discover sources through source sets, then retrieve evidence with ask_source.",
      homepage: site,
    },
    transport: {
      type: "streamable-http",
      url: `${api}/mcp`,
    },
    capabilities: {
      tools: true,
      resources: false,
      prompts: false,
    },
    authentication: {
      type: "oauth2",
      authorization_server: `${api}/.well-known/oauth-authorization-server`,
      protected_resource: `${api}/.well-known/oauth-protected-resource`,
      scopes: ["mcp:read", "mcp:write"],
    },
    documentation: `${site}/developers/mcp`,
    openapi: `${site}/openapi.json`,
  };
}
