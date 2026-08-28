/** Semantic outline for crawlers — visually hidden, preserves homepage design. */
export function HomeOutlineSection() {
  return (
    <section className="sr-only" aria-label="Page outline">
      <h2>What LedgeIndex does</h2>
      <p>
        LedgeIndex crawls documentation and code, indexes content for retrieval,
        and serves grounded answers through a web app, REST API, MCP server, SDK,
        CLI, and website widget.
      </p>
      <h3>Grounded answers</h3>
      <p>
        Chat replies include links back to the pages they came from so people can
        open and check the source.
      </p>
      <h3>Ways to run it</h3>
      <p>
        Use the hosted cloud app, the desktop app, Docker, the npm CLI, or the
        TypeScript SDK.
      </p>
      <h2>Developer resources</h2>
      <p>
        Machine-readable and human docs for the LedgeIndex API, MCP server, CLI,
        and authentication.
      </p>
      <h3>LedgeIndex API</h3>
      <ul>
        <li>OpenAPI specification at /openapi.json and /developers/openapi</li>
        <li>REST API docs at /developers/api</li>
        <li>Authentication at /developers/auth</li>
      </ul>
      <h3>LedgeIndex MCP server</h3>
      <ul>
        <li>MCP manifest at /.well-known/mcp.json</li>
        <li>Streamable HTTP transport documented at /developers/mcp</li>
        <li>OAuth metadata at /.well-known/oauth-authorization-server</li>
      </ul>
      <h3>LedgeIndex CLI</h3>
      <ul>
        <li>Install with npm install -g ledgeindex</li>
        <li>CLI docs at /developers/cli</li>
      </ul>
      <h2>Trust and contact</h2>
      <ul>
        <li>About LedgeIndex at /about</li>
        <li>Contact at /contact</li>
        <li>Privacy policy at /privacy</li>
        <li>Developer portal at /developers</li>
      </ul>
    </section>
  );
}
