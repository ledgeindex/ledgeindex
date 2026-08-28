import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  acceptsMarkdown,
  isAiAgentUserAgent,
  MARKDOWN_NEGOTIATION_PATHS,
  prefersHtml,
  shouldServeMarkdownNotFound,
} from "./constants.ts";
import { buildLlmsTxt } from "./llms-txt.ts";
import { buildOpenApiSpec, buildMcpManifest } from "./openapi.ts";
import {
  homeMarkdown,
  markdownForPath,
  notFoundMarkdown,
} from "./markdown.ts";
import { developerPages } from "./developer-content.ts";

describe("agent-readiness constants", () => {
  it("detects AI agent user agents", () => {
    assert.equal(isAiAgentUserAgent("Mozilla/5.0 GPTBot/1.0"), true);
    assert.equal(isAiAgentUserAgent("ChatGPT-User/1.0"), true);
    assert.equal(isAiAgentUserAgent("ClaudeBot/1.0"), true);
    assert.equal(isAiAgentUserAgent("PerplexityBot/1.0"), true);
    assert.equal(isAiAgentUserAgent("Mozilla/5.0 Chrome/120"), false);
  });

  it("detects markdown accept header", () => {
    assert.equal(acceptsMarkdown("text/markdown"), true);
    assert.equal(acceptsMarkdown("text/html, text/markdown;q=0.9"), true);
    assert.equal(acceptsMarkdown("text/html"), false);
  });

  it("serves markdown 404 for curl and agents, HTML for browsers", () => {
    assert.equal(prefersHtml("text/html,application/xhtml+xml"), true);
    assert.equal(prefersHtml("*/*"), false);
    assert.equal(shouldServeMarkdownNotFound("*/*", null), true);
    assert.equal(shouldServeMarkdownNotFound(null, "ChatGPT-User/1.0"), true);
    assert.equal(
      shouldServeMarkdownNotFound("text/html", "Mozilla/5.0 Chrome/120"),
      false,
    );
  });

  it("lists markdown negotiation paths", () => {
    assert.ok(MARKDOWN_NEGOTIATION_PATHS.has("/"));
    assert.ok(MARKDOWN_NEGOTIATION_PATHS.has("/about"));
    assert.ok(MARKDOWN_NEGOTIATION_PATHS.has("/developers/cli"));
  });
});

describe("llms.txt", () => {
  it("includes developer resource links by product name", () => {
    const body = buildLlmsTxt();
    assert.match(body, /LedgeIndex developer portal/);
    assert.match(body, /LedgeIndex API/);
    assert.match(body, /LedgeIndex CLI/);
    assert.match(body, /LedgeIndex MCP server/);
    assert.match(body, /LedgeIndex authentication/);
    assert.match(body, /LedgeIndex SDK/);
    assert.match(body, /openapi\.json/);
    assert.match(body, /npx ledgeindex/);
    assert.match(body, /When to use LedgeIndex/);
  });
});

describe("openapi spec", () => {
  it("includes oauth2 scopes and operationIds", () => {
    const spec = buildOpenApiSpec();
    assert.equal(spec.openapi, "3.1.0");
    assert.ok(spec.paths["/health"]?.get?.operationId);
    assert.ok(spec.components.securitySchemes.oauth2.flows.authorizationCode.scopes["mcp:read"]);
    assert.ok(spec["x-mcp"]?.transport);
  });

  it("documents RFC 9457 errors, versioning, and rate-limit headers", () => {
    const spec = buildOpenApiSpec();
    assert.equal(spec.info.version, "1.0.0");
    assert.ok(spec.servers.some((server) => server.url.endsWith("/v1")));
    assert.ok(spec.components.schemas.Problem.properties.code);
    assert.ok(spec.components.headers.RateLimit);
    assert.match(spec.info.description, /Sunset/);
    const health401 = spec.paths["/health"].get.responses["401"];
    assert.ok(health401.content["application/problem+json"]);
  });

  it("covers most operations with JSON response schemas", () => {
    const spec = buildOpenApiSpec();
    const operations: Array<{ responses?: Record<string, { content?: Record<string, unknown> }> }> =
      [];
    for (const pathItem of Object.values(spec.paths)) {
      for (const op of Object.values(pathItem)) {
        if (op && typeof op === "object" && "operationId" in op) {
          operations.push(op as (typeof operations)[number]);
        }
      }
    }
    const withJson = operations.filter((op) => {
      const ok = op.responses?.["200"] ?? op.responses?.["201"];
      return Boolean(ok?.content?.["application/json"]);
    });
    assert.ok(operations.length >= 7);
    assert.ok(withJson.length / operations.length > 0.6);
  });
});

describe("mcp manifest", () => {
  it("points at streamable HTTP transport", () => {
    const manifest = buildMcpManifest();
    assert.equal(manifest.transport.type, "streamable-http");
    assert.ok(manifest.transport.url.endsWith("/mcp"));
    assert.equal(manifest.protocolVersion, "2025-03-26");
    assert.equal(manifest.capabilities.tools, true);
  });
});

describe("markdown bodies", () => {
  it("home markdown has title and links", () => {
    const md = homeMarkdown();
    assert.match(md, /^# LedgeIndex/m);
    assert.match(md, /llms\.txt/);
    assert.ok(md.length > 500);
  });

  it("404 markdown references sitemap", () => {
    const md = notFoundMarkdown("/missing-page");
    assert.match(md, /Not found/);
    assert.match(md, /sitemap\.xml/);
    assert.match(md, /llms\.txt/);
  });

  it("trust pages exceed minimum length", () => {
    for (const path of ["/about", "/contact", "/privacy"]) {
      const md = markdownForPath(path);
      assert.ok(md && md.length > 500, path);
    }
  });
});

describe("developer pages", () => {
  it("names API, CLI, MCP, auth, and onboarding in headings", () => {
    const pages = developerPages();
    const h1s = pages.map((page) => page.h1).join("\n");
    assert.match(h1s, /LedgeIndex developer portal/);
    assert.match(h1s, /LedgeIndex API/);
    assert.match(h1s, /LedgeIndex CLI/);
    assert.match(h1s, /LedgeIndex MCP server/);
    assert.match(h1s, /LedgeIndex authentication/);
    assert.match(h1s, /LedgeIndex onboarding/);
    const cli = pages.find((page) => page.id === "cli");
    assert.ok(cli?.sections.some((section) =>
      section.body.some((line) => line.includes("npm install -g ledgeindex")),
    ));
    const onboarding = pages.find((page) => page.id === "onboarding");
    assert.ok(onboarding?.sections.some((section) =>
      section.body.some((line) => /25 cloud chat messages/i.test(line)),
    ));
  });
});
