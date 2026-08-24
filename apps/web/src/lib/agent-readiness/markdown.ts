import { getSiteUrl } from "@/lib/site-url";
import { docsSiteHref } from "@/lib/docs-site-url";
import { getPublicApiBaseUrl } from "./api-base";

function docsUrl(path: string): string {
  const base = docsSiteHref();
  const site = getSiteUrl();
  const root = base.startsWith("http") ? base.replace(/\/docs\/?$/, "") : site;
  return `${root}${path.startsWith("/") ? path : `/${path}`}`;
}

export function homeMarkdown(): string {
  const site = getSiteUrl();
  return `# LedgeIndex

Turn your documentation into answers people trust.

Point LedgeIndex at your docs. Users get replies with links back to the pages they came from.

## Use cases

- Docs chat for support and onboarding
- MCP tools for AI coding agents (Cursor, Claude)
- Website widget embedded on your marketing site
- Self-hosted indexing with Docker or npm packages

## Developer links

- Docs: ${docsUrl("/docs")}
- OpenAPI: ${site}/openapi.json
- llms.txt: ${site}/llms.txt
- MCP: ${getPublicApiBaseUrl()}/mcp
`;
}

export function notFoundMarkdown(pathname: string): string {
  const site = getSiteUrl();
  return `# Not found

The path \`${pathname}\` does not exist on ${site}.

## Where to look next

- [Home](${site}/)
- [Documentation](${docsUrl("/docs")})
- [OpenAPI spec](${site}/openapi.json)
- [llms.txt](${site}/llms.txt)
- [Sitemap](${site}/sitemap.xml)
`;
}

export function aboutMarkdown(): string {
  const site = getSiteUrl();
  return `# About LedgeIndex

LedgeIndex is knowledge infrastructure for AI agents. Teams use it to crawl documentation and code, index content for retrieval, and serve grounded answers through a web app, REST API, MCP server, SDK, CLI, and embeddable website widget.

We build for developers who need citations, local-first self-hosting, and a hosted cloud option with the same open-source core.

## Product

- **Web app** at ${site} — crawl, index, chat, source sets, and MCP connect
- **Desktop app** — local indexing with optional cloud sync
- **API** at ${getPublicApiBaseUrl()} — sources, ingest, chat, widget, OAuth for MCP

## Open source

Core packages are fair-code licensed for self-hosting and embedding in your own products. See ${site}/#open-source.

## Contact

- [Contact page](${site}/contact)
- [Privacy policy](${site}/privacy)
`;
}

export function contactMarkdown(): string {
  const site = getSiteUrl();
  return `# Contact LedgeIndex

## Support and sales

Email: hello@ledgeindex.com

We read every message. For API or MCP integration questions, include your use case and whether you self-host or use LedgeIndex cloud.

## Self-serve onboarding

You do not need to contact us to start. Sign in at ${site}/login, open API keys in the app, and run a local sandbox with Docker or \`npm run dev:api\`. The free tier includes daily cloud chat limits; self-hosting on your machine is unlimited.

## Community

- [Discord](https://discord.gg/gzeKZxsrsP)
- [GitHub](https://github.com/ledgeindex/ledgeindex)

## Developer resources

- [Documentation](${docsUrl("/docs")})
- [OpenAPI spec](${site}/openapi.json)
- [MCP server](${getPublicApiBaseUrl()}/mcp)

## Legal

- [Privacy policy](${site}/privacy)
- [About](${site}/about)
`;
}

export function privacyMarkdown(): string {
  const site = getSiteUrl();
  return `# Privacy policy

Last updated: 2026-08-24

LedgeIndex ("we", "us") operates ${site} and the LedgeIndex API. This page describes how we handle information when you use our hosted cloud service.

## What we collect

- **Account data:** email and profile from Firebase Authentication when you sign in
- **Content you index:** URLs, files, and metadata you choose to crawl or upload
- **Usage:** API and chat usage meters for billing and abuse prevention

## How we use data

We use your data to provide indexing, search, chat, MCP, and widget features you request. We do not sell personal data.

## Self-hosting

When you run LedgeIndex locally or in your own infrastructure, your data stays on your systems. This policy applies primarily to the hosted service at ${site} and api.ledgeindex.com.

## Contact

Questions: hello@ledgeindex.com

See also [About](${site}/about) and [Contact](${site}/contact).
`;
}

import { buildLlmsTxt } from "./llms-txt";

export function markdownForPath(pathname: string): string | null {
  switch (pathname) {
    case "/":
      return homeMarkdown();
    case "/about":
      return aboutMarkdown();
    case "/contact":
      return contactMarkdown();
    case "/privacy":
      return privacyMarkdown();
    case "/llms.txt":
      return buildLlmsTxt();
    default:
      return null;
  }
}
