import type { Metadata } from "next";
import { TrustPageShell } from "@/components/marketing/trust-page-shell";
import { getSiteUrl } from "@/lib/site-url";
import { docsSiteHref } from "@/lib/docs-site-url";
import { getPublicApiBaseUrl } from "@/lib/agent-readiness/api-base";

export const metadata: Metadata = {
  title: "About LedgeIndex | Knowledge infrastructure for AI agents",
  description:
    "LedgeIndex helps teams crawl documentation and code, index content for retrieval, and serve grounded answers through SDK, API, MCP, and widgets.",
  alternates: { canonical: `${getSiteUrl()}/about` },
};

export default function AboutPage() {
  const site = getSiteUrl();
  const docs = docsSiteHref().startsWith("http")
    ? docsSiteHref()
    : `${site}${docsSiteHref()}`;
  const api = getPublicApiBaseUrl();

  return (
    <TrustPageShell title="About">
      <h1 className="mt-6 text-3xl font-semibold tracking-tight text-foreground">
        About LedgeIndex
      </h1>
      <div className="prose prose-neutral mt-8 max-w-2xl text-muted dark:prose-invert">
        <p className="text-base leading-7">
          LedgeIndex is knowledge infrastructure for AI agents. Teams use it to
          crawl documentation and code, index content for retrieval, and serve
          grounded answers through a web app, REST API, MCP server, SDK, CLI, and
          embeddable website widget.
        </p>
        <p className="text-base leading-7">
          We build for developers who need citations, local-first self-hosting,
          and a hosted cloud option with the same open-source core. Sign in at{" "}
          <a href={`${site}/login`} className="text-accent">
            {site}/login
          </a>{" "}
          to create sources, connect MCP clients, and issue API keys without
          talking to sales.
        </p>
        <h2 className="mt-10 text-xl font-semibold text-foreground">
          Product surfaces
        </h2>
        <ul className="list-disc space-y-2 pl-5 text-base leading-7">
          <li>
            Web app at {site} — crawl, index, chat, source sets, and MCP connect
          </li>
          <li>Desktop app — local indexing with optional cloud sync</li>
          <li>
            API at {api} — sources, ingest, chat, widget, and OAuth for MCP
          </li>
        </ul>
        <h2 className="mt-10 text-xl font-semibold text-foreground">
          Open source
        </h2>
        <p className="text-base leading-7">
          Core packages are fair-code licensed for self-hosting and embedding in
          your own products. Explore the repository on{" "}
          <a
            href="https://github.com/ledgeindex/ledgeindex"
            className="text-accent"
          >
            GitHub
          </a>{" "}
          or read the{" "}
          <a href={docs} className="text-accent">
            documentation
          </a>
          .
        </p>
      </div>
    </TrustPageShell>
  );
}
