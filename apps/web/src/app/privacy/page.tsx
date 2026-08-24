import type { Metadata } from "next";
import Link from "next/link";
import { TrustPageShell } from "@/components/marketing/trust-page-shell";
import { getSiteUrl } from "@/lib/site-url";

export const metadata: Metadata = {
  title: "Privacy Policy | LedgeIndex",
  description:
    "How LedgeIndex handles account data, indexed content, and usage on the hosted cloud service.",
  alternates: { canonical: `${getSiteUrl()}/privacy` },
};

export default function PrivacyPage() {
  const site = getSiteUrl();

  return (
    <TrustPageShell title="Privacy">
      <h1 className="mt-6 text-3xl font-semibold tracking-tight text-foreground">
        Privacy policy
      </h1>
      <p className="mt-3 text-sm text-muted">Last updated: August 24, 2026</p>
      <div className="prose prose-neutral mt-8 max-w-2xl text-muted dark:prose-invert">
        <p className="text-base leading-7">
          LedgeIndex (&quot;we&quot;, &quot;us&quot;) operates {site} and the
          LedgeIndex API. This page describes how we handle information when you
          use our hosted cloud service.
        </p>
        <h2 className="text-xl font-semibold text-foreground">
          What we collect
        </h2>
        <ul className="list-disc space-y-2 pl-5 text-base leading-7">
          <li>
            Account data: email and profile from Firebase Authentication when you
            sign in
          </li>
          <li>
            Content you index: URLs, files, and metadata you choose to crawl or
            upload
          </li>
          <li>
            Usage: API and chat usage meters for billing and abuse prevention
          </li>
        </ul>
        <h2 className="mt-10 text-xl font-semibold text-foreground">
          How we use data
        </h2>
        <p className="text-base leading-7">
          We use your data to provide indexing, search, chat, MCP, and widget
          features you request. We do not sell personal data.
        </p>
        <h2 className="mt-10 text-xl font-semibold text-foreground">
          Self-hosting
        </h2>
        <p className="text-base leading-7">
          When you run LedgeIndex locally or in your own infrastructure, your
          data stays on your systems. This policy applies primarily to the hosted
          service at {site} and api.ledgeindex.com.
        </p>
        <h2 className="mt-10 text-xl font-semibold text-foreground">
          Contact
        </h2>
        <p className="text-base leading-7">
          Questions:{" "}
          <a href="mailto:hello@ledgeindex.com" className="text-accent">
            hello@ledgeindex.com
          </a>
          . See also{" "}
          <Link href="/about" className="text-accent">
            About
          </Link>{" "}
          and{" "}
          <Link href="/contact" className="text-accent">
            Contact
          </Link>
          .
        </p>
      </div>
    </TrustPageShell>
  );
}
