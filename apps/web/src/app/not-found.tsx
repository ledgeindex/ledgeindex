import Link from "next/link";
import { Container } from "@/components/ui/container";
import { notFoundMarkdown } from "@/lib/agent-readiness/markdown";
import { docsSiteHref } from "@/lib/docs-site-url";
import { getSiteUrl } from "@/lib/site-url";

export default function NotFound() {
  const site = getSiteUrl();
  const docs = docsSiteHref();

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <pre className="sr-only" id="agent-404">
        {notFoundMarkdown("/not-found")}
      </pre>
      <Container className="flex flex-1 flex-col justify-center py-16">
        <p className="font-mono text-xs font-semibold tracking-[0.18em] text-muted uppercase">
          404
        </p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight text-foreground">
          Page not found
        </h1>
        <p className="mt-3 max-w-lg text-sm leading-7 text-muted">
          This path is not on LedgeIndex. Try the docs, sitemap, or llms.txt for
          agent-friendly discovery.
        </p>
        <ul className="mt-6 space-y-2 text-sm">
          <li>
            <Link href="/" className="text-accent hover:underline">
              Home
            </Link>
          </li>
          <li>
            <a href={docs} className="text-accent hover:underline">
              Documentation
            </a>
          </li>
          <li>
            <Link href="/llms.txt" className="text-accent hover:underline">
              llms.txt
            </Link>
          </li>
          <li>
            <Link href="/openapi.json" className="text-accent hover:underline">
              openapi.json
            </Link>
          </li>
          <li>
            <a
              href={`${site}/sitemap.xml`}
              className="text-accent hover:underline"
            >
              sitemap.xml
            </a>
          </li>
        </ul>
      </Container>
    </div>
  );
}
