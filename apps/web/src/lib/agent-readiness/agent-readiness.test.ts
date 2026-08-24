import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  acceptsMarkdown,
  isAiAgentUserAgent,
  MARKDOWN_NEGOTIATION_PATHS,
} from "./constants.ts";
import { buildLlmsTxt } from "./llms-txt.ts";
import { buildOpenApiSpec, buildMcpManifest } from "./openapi.ts";
import {
  homeMarkdown,
  markdownForPath,
  notFoundMarkdown,
} from "./markdown.ts";

describe("agent-readiness constants", () => {
  it("detects AI agent user agents", () => {
    assert.equal(isAiAgentUserAgent("Mozilla/5.0 GPTBot/1.0"), true);
    assert.equal(isAiAgentUserAgent("ChatGPT-User/1.0"), true);
    assert.equal(isAiAgentUserAgent("ClaudeBot/1.0"), true);
    assert.equal(isAiAgentUserAgent("Mozilla/5.0 Chrome/120"), false);
  });

  it("detects markdown accept header", () => {
    assert.equal(acceptsMarkdown("text/markdown"), true);
    assert.equal(acceptsMarkdown("text/html, text/markdown;q=0.9"), true);
    assert.equal(acceptsMarkdown("text/html"), false);
  });

  it("lists markdown negotiation paths", () => {
    assert.ok(MARKDOWN_NEGOTIATION_PATHS.has("/"));
    assert.ok(MARKDOWN_NEGOTIATION_PATHS.has("/about"));
  });
});

describe("llms.txt", () => {
  it("includes developer resource links", () => {
    const body = buildLlmsTxt();
    assert.match(body, /OpenAPI spec/);
    assert.match(body, /openapi\.json/);
    assert.match(body, /MCP server/);
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
});

describe("mcp manifest", () => {
  it("points at streamable HTTP transport", () => {
    const manifest = buildMcpManifest();
    assert.equal(manifest.transport.type, "streamable-http");
    assert.ok(manifest.transport.url.endsWith("/mcp"));
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
  });

  it("trust pages exceed minimum length", () => {
    for (const path of ["/about", "/contact", "/privacy"]) {
      const md = markdownForPath(path);
      assert.ok(md && md.length > 500, path);
    }
  });
});
