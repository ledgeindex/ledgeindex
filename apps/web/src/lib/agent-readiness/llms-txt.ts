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

- [LedgeIndex developer portal](${site}/developers): index of API, CLI, MCP, SDK, auth, and onboarding
- [LedgeIndex API](${site}/developers/api): REST at ${api}/v1 (unversioned ${api} is the v1 alias)
- [LedgeIndex OpenAPI spec](${site}/openapi.json): OpenAPI 3.1, also at ${api}/openapi.json
- [LedgeIndex authentication](${site}/developers/auth): Firebase ID tokens and live_ API keys
- [LedgeIndex MCP server](${site}/developers/mcp): Streamable HTTP at ${api}/mcp ; manifest at ${site}/.well-known/mcp.json
- [LedgeIndex CLI](${site}/developers/cli): npm package \`ledgeindex\` (\`npx ledgeindex\`, \`npm install -g ledgeindex\`)
- [LedgeIndex SDK](${site}/developers/sdk): \`@ledgeindex/sdk\` and \`@ledgeindex/client\`
- [Documentation](${docs}): guides for web, desktop, SDK, CLI, and Docker
- [API reference](${docs}/reference/api): REST endpoints for sources, chat, ingest, and widget

## Onboarding

- [LedgeIndex onboarding](${site}/developers/onboarding)
- Free tier: sign in at ${site}/login — 1 source set, 3 sources, 25 cloud chat messages per UTC day. Self-host is unmetered.
- Self-serve API keys: ${site}/api-keys after sign-in. A Playground live_ key is created automatically.
- Sandbox: \`npm run dev:api\` (http://localhost:3010) or \`docker compose -f docker-compose.oss.yml up --build\`

## Optional

- [About](${site}/about)
- [Contact](${site}/contact)
- [Privacy](${site}/privacy)
- [Sitemap](${site}/sitemap.xml)
`;
}
