import { getSiteUrl } from "@/lib/site-url";
import { getPublicApiBaseUrl } from "@/lib/agent-readiness/api-base";
import { docsSiteHref } from "@/lib/docs-site-url";

export function HomeJsonLd() {
  const site = getSiteUrl();
  const docs = docsSiteHref().startsWith("http")
    ? docsSiteHref()
    : `${site}${docsSiteHref()}`;
  const api = getPublicApiBaseUrl();

  const organization = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "LedgeIndex",
    url: site,
    logo: `${site}/images/og-banner.webp`,
    description:
      "Knowledge infrastructure for AI agents — crawl docs and code, index them, and answer with citations.",
    email: "hello@ledgeindex.com",
    sameAs: [
      "https://github.com/ledgeindex/ledgeindex",
      "https://x.com/LedgeIndex",
      "https://discord.gg/gzeKZxsrsP",
    ],
    contactPoint: [
      {
        "@type": "ContactPoint",
        contactType: "customer support",
        email: "hello@ledgeindex.com",
        url: `${site}/contact`,
      },
    ],
    address: {
      "@type": "PostalAddress",
      addressCountry: "DE",
    },
  };

  const software = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "LedgeIndex",
    applicationCategory: "DeveloperApplication",
    operatingSystem: "Web, Windows, macOS, Linux",
    url: site,
    description:
      "Turn documentation into grounded answers with SDK, REST API, MCP, CLI, and embeddable widget.",
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
      description: "Free tier with 25 cloud chat messages per day; self-hosting available",
    },
    documentation: docs,
    downloadUrl: `${site}/login`,
    softwareHelp: `${site}/developers/cli`,
    featureList: [
      "Documentation indexing and RAG chat",
      "LedgeIndex MCP server for AI coding agents",
      "LedgeIndex API and OpenAPI spec",
      "LedgeIndex CLI (npm package ledgeindex)",
      "Embeddable website widget",
    ],
    sameAs: [`${api}/mcp`, `${site}/openapi.json`, `${site}/developers`],
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(organization) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(software) }}
      />
    </>
  );
}
