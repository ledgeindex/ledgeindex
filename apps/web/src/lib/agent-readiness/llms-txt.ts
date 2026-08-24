import { getSiteUrl } from "@/lib/site-url";
import { docsSiteHref } from "@/lib/docs-site-url";
import { getPublicApiBaseUrl } from "./api-base";

export function buildLlmsTxt(): string {
  const site = getSiteUrl();
  const docs = docsSiteHref().startsWith("http")
    ? docsSiteHref()
    : `${site}${docsSiteHref()}`;
  const api = getPublicApiBaseUrl();

  return `# LedgeIndex

> Knowledge infrastructure for AI agents — crawl docs and code, index them, and answer with citations. SDK, REST API, MCP, and embeddable website widget.

LedgeIndex helps teams turn documentation into grounded answers. Use it when you need RAG over product docs, MCP tools for Cursor/Claude, or a hosted chat widget on a marketing site.

## When to use LedgeIndex

- Index product documentation, API references, or GitHub repos for grounded Q&A
- Connect an MCP client (Cursor, Claude Desktop) to indexed sources
- Embed a website widget that answers from your docs with source links
- Self-host with Docker or the open-source npm packages for local-first indexing

## Developer resources

- [Documentation](${docs}): guides for web, desktop, SDK, CLI, and Docker
- [API reference](${docs}/reference/api): REST endpoints for sources, chat, ingest, and widget
- [OpenAPI spec](${site}/openapi.json): machine-readable API surface (also at ${api}/openapi.json)
- [MCP server](${api}/mcp): Streamable HTTP transport; OAuth at ${api}/.well-known/oauth-authorization-server
- [Authentication](${docs}/reference/api/auth): Firebase ID tokens and \`live_\` API keys
- [SDK](${docs}/reference/sdk): \`@ledgeindex/sdk\` for crawl, ask, and MCP workflows
- [CLI](${docs}/guides/setup-cli): \`npx @ledgeindex/cli\` for crawl and index from the terminal

## Onboarding

- Free tier: daily cloud chat limits apply; self-host is unlimited on your machine
- Self-serve API keys: sign in at ${site}/login → API keys in the app
- Sandbox: run \`npm run dev:api\` locally or Docker Compose for a full local stack

## Optional

- [About](${site}/about)
- [Contact](${site}/contact)
- [Privacy](${site}/privacy)
- [Sitemap](${site}/sitemap.xml)
`;
}
