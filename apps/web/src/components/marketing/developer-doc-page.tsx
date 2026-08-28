import type { Metadata } from "next";
import { TrustPageShell } from "@/components/marketing/trust-page-shell";
import type { DeveloperPageDef } from "@/lib/agent-readiness/developer-content";
import { getSiteUrl } from "@/lib/site-url";

export function developerPageMetadata(page: DeveloperPageDef): Metadata {
  return {
    title: `${page.title} | LedgeIndex`,
    description: page.description,
    alternates: { canonical: `${getSiteUrl()}${page.path}` },
  };
}

export function DeveloperDocPage({ page }: { page: DeveloperPageDef }) {
  return (
    <TrustPageShell title={page.title}>
      <h1 className="mt-6 text-3xl font-semibold tracking-tight text-foreground">
        {page.h1}
      </h1>
      <p className="mt-4 max-w-2xl text-base leading-7 text-muted">
        {page.description}
      </p>
      <div className="prose prose-neutral mt-8 max-w-2xl text-muted dark:prose-invert">
        {page.sections.map((section) => (
          <section key={section.heading}>
            <h2 className="mt-10 text-xl font-semibold text-foreground">
              {section.heading}
            </h2>
            <ul className="list-disc space-y-2 pl-5 text-base leading-7">
              {section.body.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </TrustPageShell>
  );
}
