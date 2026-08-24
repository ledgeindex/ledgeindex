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
      <h2>Developer resources</h2>
      <ul>
        <li>OpenAPI specification at /openapi.json</li>
        <li>Agent instructions at /llms.txt</li>
        <li>MCP manifest at /.well-known/mcp.json</li>
        <li>OAuth metadata at /.well-known/oauth-authorization-server</li>
      </ul>
      <h2>Trust and contact</h2>
      <ul>
        <li>About LedgeIndex at /about</li>
        <li>Contact at /contact</li>
        <li>Privacy policy at /privacy</li>
      </ul>
    </section>
  );
}
