import type { Metadata } from "next";
import Link from "next/link";
import { TrustPageShell } from "@/components/marketing/trust-page-shell";
import { getSiteUrl } from "@/lib/site-url";

export const metadata: Metadata = {
  title: "Contact LedgeIndex | Support and integrations",
  description:
    "Reach LedgeIndex for support, API integration questions, and partnership inquiries.",
  alternates: { canonical: `${getSiteUrl()}/contact` },
};

export default function ContactPage() {
  const site = getSiteUrl();

  return (
    <TrustPageShell title="Contact">
      <h1 className="mt-6 text-3xl font-semibold tracking-tight text-foreground">
        Contact LedgeIndex
      </h1>
      <div className="prose prose-neutral mt-8 max-w-2xl text-muted dark:prose-invert">
        <h2 className="text-xl font-semibold text-foreground">
          Support and sales
        </h2>
        <p className="text-base leading-7">
          Email{" "}
          <a href="mailto:hello@ledgeindex.com" className="text-accent">
            hello@ledgeindex.com
          </a>
          . We read every message. For API or MCP integration questions, include
          your use case and whether you self-host or use LedgeIndex cloud.
        </p>
        <h2 className="mt-10 text-xl font-semibold text-foreground">
          Self-serve onboarding
        </h2>
        <p className="text-base leading-7">
          You do not need to contact us to get started. Create an account at{" "}
          <Link href="/login" className="text-accent">
            {site}/login
          </Link>
          , generate API keys in the app, and run a local sandbox with Docker or{" "}
          <code className="text-sm">npm run dev:api</code>.
        </p>
        <h2 className="mt-10 text-xl font-semibold text-foreground">
          Community
        </h2>
        <ul className="list-disc space-y-2 pl-5 text-base leading-7">
          <li>
            <a href="https://discord.gg/gzeKZxsrsP" className="text-accent">
              Discord
            </a>
          </li>
          <li>
            <a
              href="https://github.com/ledgeindex/ledgeindex"
              className="text-accent"
            >
              GitHub
            </a>
          </li>
        </ul>
        <h2 className="mt-10 text-xl font-semibold text-foreground">Legal</h2>
        <ul className="list-disc space-y-2 pl-5 text-base leading-7">
          <li>
            <Link href="/privacy" className="text-accent">
              Privacy policy
            </Link>
          </li>
          <li>
            <Link href="/about" className="text-accent">
              About LedgeIndex
            </Link>
          </li>
        </ul>
      </div>
    </TrustPageShell>
  );
}
