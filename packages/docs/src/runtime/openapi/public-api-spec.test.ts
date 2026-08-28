import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildPublicOpenApiSpec,
  buildPublicMcpManifest,
  defaultPublicApiSpecUrls,
} from "./public-api-spec.ts";

describe("public OpenAPI spec", () => {
  it("includes oauth2 scopes and operationIds", () => {
    const spec = buildPublicOpenApiSpec(defaultPublicApiSpecUrls());
    assert.equal(spec.openapi, "3.1.0");
    assert.ok(spec.paths["/health"]?.get?.operationId);
    assert.ok(
      spec.components.securitySchemes.oauth2.flows.authorizationCode.scopes[
        "mcp:read"
      ],
    );
    assert.ok(spec["x-mcp"]?.transport);
  });

  it("documents typed errors, /v1 versioning, and rate-limit headers", () => {
    const spec = buildPublicOpenApiSpec(defaultPublicApiSpecUrls());
    assert.equal(spec.info.version, "1.0.0");
    assert.ok(spec.servers.some((server) => /\/v1$/.test(server.url)));
    assert.equal(spec.components.schemas.Problem.required.includes("code"), true);
    assert.ok(spec.components.headers.RateLimit);
    assert.ok(
      spec.paths["/api/sources"].get.responses["401"].content[
        "application/problem+json"
      ],
    );
  });

  it("covers most operations with JSON response schemas", () => {
    const spec = buildPublicOpenApiSpec(defaultPublicApiSpecUrls());
    const operations: Array<{
      operationId?: string;
      responses?: Record<string, { content?: Record<string, unknown> }>;
    }> = [];
    for (const pathItem of Object.values(spec.paths)) {
      for (const op of Object.values(
        pathItem as Record<string, (typeof operations)[number]>,
      )) {
        if (op?.operationId) operations.push(op);
      }
    }
    const withJson = operations.filter((op) => {
      const ok = op.responses?.["200"] ?? op.responses?.["201"];
      return Boolean(ok?.content?.["application/json"]);
    });
    assert.ok(withJson.length / operations.length > 0.6);
  });

  it("MCP manifest uses streamable HTTP", () => {
    const manifest = buildPublicMcpManifest(defaultPublicApiSpecUrls());
    assert.equal(manifest.transport.type, "streamable-http");
    assert.ok(manifest.transport.url.endsWith("/mcp"));
    assert.equal(manifest.capabilities.tools, true);
  });
});
