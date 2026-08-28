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

export function buildPublicOpenApiSpec(urls: PublicApiSpecUrls) {
  const { siteUrl: site, apiUrl: api } = urls;

  return {
    openapi: "3.1.0",
    info: {
      title: "LedgeIndex API",
      version: "0.1.0",
      description:
        "REST API for LedgeIndex — sources, ingest, chat, widget, and usage. Authenticate with Firebase ID token (Bearer) or a live_ API key.",
      contact: {
        name: "LedgeIndex",
        url: site,
        email: "hello@ledgeindex.com",
      },
    },
    servers: [{ url: api, description: "LedgeIndex hosted API" }],
    tags: [
      { name: "health", description: "Service health and MCP discovery" },
      { name: "sources", description: "Knowledge sources and ingest" },
      { name: "chat", description: "Grounded chat over indexed sources" },
      { name: "widget", description: "Public embeddable website widget" },
      { name: "auth", description: "Account and API keys" },
      { name: "usage", description: "Cloud usage meters" },
    ],
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
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/HealthResponse" },
                },
              },
            },
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
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/SourceListResponse" },
                },
              },
            },
          },
        },
        post: {
          operationId: "createSource",
          summary: "Create a web crawl source",
          tags: ["sources"],
          security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
          responses: { "201": { description: "Source created" } },
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
              "application/json": {
                schema: {
                  type: "object",
                  required: ["message"],
                  properties: {
                    message: { type: "string" },
                  },
                },
              },
            },
          },
          responses: {
            "200": { description: "Answer with citations" },
            "429": { description: "Daily message limit exceeded" },
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
              "application/json": {
                schema: {
                  type: "object",
                  required: ["websiteId", "message"],
                  properties: {
                    websiteId: { type: "string" },
                    message: { type: "string" },
                    sourceId: { type: "string" },
                  },
                },
              },
            },
          },
          responses: {
            "200": { description: "text/event-stream token stream" },
            "403": { description: "Origin not allowed" },
            "429": { description: "Rate or daily limit exceeded" },
          },
        },
      },
      "/api/auth/me": {
        get: {
          operationId: "getAuthMe",
          summary: "Current user profile and plan limits",
          tags: ["auth"],
          security: [{ bearerAuth: [] }],
          responses: { "200": { description: "User profile" } },
        },
      },
      "/api/usage/cloud-messages": {
        get: {
          operationId: "getCloudMessageUsage",
          summary: "Daily cloud chat usage for the signed-in user",
          tags: ["usage"],
          security: [{ bearerAuth: [] }],
          responses: {
            "200": {
              description: "Usage meter",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/DailyMessageUsage" },
                },
              },
            },
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
      schemas: {
        HealthResponse: {
          type: "object",
          properties: {
            status: { type: "string" },
            service: { type: "string" },
            mastra: { type: "object" },
          },
        },
        SourceListResponse: {
          type: "object",
          properties: {
            sources: { type: "array", items: { type: "object" } },
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
          },
        },
      },
    },
    "x-mcp": {
      transport: `${api}/mcp`,
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
    version: "0.1.0",
    transport: {
      type: "streamable-http",
      url: `${api}/mcp`,
    },
    authentication: {
      type: "oauth2",
      authorization_server: `${api}/.well-known/oauth-authorization-server`,
      protected_resource: `${api}/.well-known/oauth-protected-resource`,
      scopes: ["mcp:read", "mcp:write"],
    },
    documentation: `${site}/docs/reference/api/health`,
    openapi: `${site}/openapi.json`,
  };
}
