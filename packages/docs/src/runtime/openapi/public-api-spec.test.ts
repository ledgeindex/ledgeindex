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

  it("MCP manifest uses streamable HTTP", () => {
    const manifest = buildPublicMcpManifest(defaultPublicApiSpecUrls());
    assert.equal(manifest.transport.type, "streamable-http");
    assert.ok(manifest.transport.url.endsWith("/mcp"));
  });
});
