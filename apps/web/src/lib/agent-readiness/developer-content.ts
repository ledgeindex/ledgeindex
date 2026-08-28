import { getSiteUrl } from "@/lib/site-url";
import { docsSiteHref } from "@/lib/docs-site-url";
import { getPublicApiBaseUrl } from "./api-base";

export type DeveloperPageId =
  | "portal"
  | "api"
  | "auth"
  | "cli"
  | "mcp"
  | "sdk"
  | "openapi"
  | "onboarding";

export type DeveloperPageDef = {
  id: DeveloperPageId;
  path: string;
  title: string;
  description: string;
  h1: string;
  sections: Array<{ heading: string; body: string[] }>;
};

function docsUrl(path: string): string {
  const base = docsSiteHref();
  const site = getSiteUrl();
  const root = base.startsWith("http") ? base.replace(/\/docs\/?$/, "") : site;
  return `${root}${path.startsWith("/") ? path : `/${path}`}`;
}

export function developerPages(): DeveloperPageDef[] {
  const site = getSiteUrl();
  const api = getPublicApiBaseUrl();
  const docs = docsUrl("/docs");

  return [
    {
      id: "portal",
      path: "/developers",
      title: "LedgeIndex developer portal",
      description:
        "LedgeIndex API, OpenAPI spec, MCP server, CLI, SDK, and authentication docs for agents and developers.",
      h1: "LedgeIndex developer portal",
      sections: [
        {
          heading: "Start here",
          body: [
            `Hosted API: ${api}`,
            `OpenAPI spec: ${site}/openapi.json`,
            `MCP server: ${api}/mcp`,
            `Documentation: ${docs}`,
          ],
        },
        {
          heading: "Named resources",
          body: [
            `LedgeIndex API — ${site}/developers/api`,
            `LedgeIndex authentication — ${site}/developers/auth`,
            `LedgeIndex CLI — ${site}/developers/cli`,
            `LedgeIndex MCP server — ${site}/developers/mcp`,
            `LedgeIndex SDK — ${site}/developers/sdk`,
            `LedgeIndex OpenAPI spec — ${site}/developers/openapi`,
            `LedgeIndex onboarding — ${site}/developers/onboarding`,
          ],
        },
      ],
    },
    {
      id: "api",
      path: "/developers/api",
      title: "LedgeIndex API",
      description:
        "LedgeIndex REST API for sources, ingest, chat, widget, and usage. Versioned at /v1 with OpenAPI at /openapi.json.",
      h1: "LedgeIndex API",
      sections: [
        {
          heading: "Base URL",
          body: [
            `Current stable version is v1. Call ${api}/v1 or ${api} (unversioned alias of v1).`,
            "Breaking changes ship as /v2. Deprecated versions send Deprecation and Sunset headers before removal.",
          ],
        },
        {
          heading: "Auth",
          body: [
            "Firebase ID token (Authorization: Bearer) or a live_ API key issued in the app.",
            `Details: ${site}/developers/auth`,
          ],
        },
        {
          heading: "Errors and rate limits",
          body: [
            "4xx and 5xx bodies use RFC 9457 application/problem+json with a machine-readable code and a human-readable detail.",
            "Responses include RateLimit and RateLimit-Policy. 429 responses also send Retry-After.",
          ],
        },
        {
          heading: "Spec",
          body: [
            `OpenAPI 3.1: ${site}/openapi.json and ${api}/openapi.json`,
            `Human summary: ${site}/developers/openapi`,
          ],
        },
      ],
    },
    {
      id: "auth",
      path: "/developers/auth",
      title: "LedgeIndex authentication",
      description:
        "Authenticate to the LedgeIndex API with a Firebase ID token or a live_ API key. MCP uses OAuth 2.0 with PKCE.",
      h1: "LedgeIndex authentication",
      sections: [
        {
          heading: "REST",
          body: [
            "Sign in at the web app, then send the Firebase ID token as Authorization: Bearer.",
            "Self-serve API keys: after login, open /api-keys. A Playground live_ key is created automatically. Extra keys require an admin role.",
          ],
        },
        {
          heading: "MCP OAuth",
          body: [
            `Authorization server: ${api}/.well-known/oauth-authorization-server`,
            `Protected resource: ${api}/.well-known/oauth-protected-resource`,
            "Scopes: mcp:read, mcp:write. PKCE required.",
          ],
        },
      ],
    },
    {
      id: "cli",
      path: "/developers/cli",
      title: "LedgeIndex CLI",
      description:
        "Official LedgeIndex CLI on npm. Crawl docs and ask questions from the terminal with npx ledgeindex or npm install -g ledgeindex.",
      h1: "LedgeIndex CLI",
      sections: [
        {
          heading: "Install",
          body: [
            "Package name on npm: ledgeindex",
            "npx ledgeindex --help",
            "npm install -g ledgeindex",
            `Guides: ${docsUrl("/guides/setup-cli")}`,
          ],
        },
        {
          heading: "What it does",
          body: [
            "Crawl a docs site, build a local index, and ask questions from the terminal.",
            "No Fastify server required. Indexes live under ~/.ledgeindex/data by default.",
          ],
        },
      ],
    },
    {
      id: "mcp",
      path: "/developers/mcp",
      title: "LedgeIndex MCP server",
      description:
        "LedgeIndex Model Context Protocol server over Streamable HTTP. Manifest at /.well-known/mcp.json.",
      h1: "LedgeIndex MCP server",
      sections: [
        {
          heading: "Connect",
          body: [
            `Manifest: ${site}/.well-known/mcp.json`,
            `Streamable HTTP: ${api}/mcp`,
            `OAuth: ${api}/.well-known/oauth-authorization-server`,
          ],
        },
        {
          heading: "Tools",
          body: [
            "list_source_sets, get_source_set, ask_source.",
            "Initialize and server/discover work without a token. Tool calls need OAuth or a live_ key.",
          ],
        },
      ],
    },
    {
      id: "sdk",
      path: "/developers/sdk",
      title: "LedgeIndex SDK",
      description:
        "TypeScript SDK @ledgeindex/sdk for crawl, ask, and MCP workflows. REST client is @ledgeindex/client.",
      h1: "LedgeIndex SDK",
      sections: [
        {
          heading: "Packages",
          body: [
            "npm install @ledgeindex/sdk",
            "npm install @ledgeindex/client",
            `Docs: ${docsUrl("/reference/sdk")}`,
          ],
        },
      ],
    },
    {
      id: "openapi",
      path: "/developers/openapi",
      title: "LedgeIndex OpenAPI spec",
      description:
        "Machine-readable OpenAPI 3.1 description of the LedgeIndex API, including typed errors and rate-limit headers.",
      h1: "LedgeIndex OpenAPI spec",
      sections: [
        {
          heading: "Download",
          body: [
            `${site}/openapi.json`,
            `${api}/openapi.json`,
            `${api}/v1/openapi.json`,
          ],
        },
      ],
    },
    {
      id: "onboarding",
      path: "/developers/onboarding",
      title: "LedgeIndex onboarding",
      description:
        "Free tier, self-serve API keys, and a local sandbox for the LedgeIndex API. No sales form required.",
      h1: "LedgeIndex onboarding",
      sections: [
        {
          heading: "Free tier",
          body: [
            "Sign in at /login. No credit card.",
            "Hosted free plan: 1 source set, 3 sources, 25 cloud chat messages per UTC day.",
            "Self-hosting on your machine has no cloud message meter.",
          ],
        },
        {
          heading: "Self-serve API keys",
          body: [
            "After sign-in, open /api-keys.",
            "A Playground live_ key is provisioned automatically. Use it as Authorization: Bearer live_…",
          ],
        },
        {
          heading: "Sandbox",
          body: [
            "Local API: npm run dev:api (http://localhost:3010, LEDGEINDEX_AUTH_REQUIRED=0).",
            "Full local stack: docker compose -f docker-compose.oss.yml up --build",
            "UI at http://localhost:3004, API at http://localhost:3010/health",
          ],
        },
      ],
    },
  ];
}

export function developerPageByPath(path: string): DeveloperPageDef | undefined {
  return developerPages().find((page) => page.path === path);
}

export function developerPageMarkdown(page: DeveloperPageDef): string {
  const lines = [`# ${page.h1}`, "", page.description, ""];
  for (const section of page.sections) {
    lines.push(`## ${section.heading}`, "");
    for (const item of section.body) {
      lines.push(`- ${item}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}
