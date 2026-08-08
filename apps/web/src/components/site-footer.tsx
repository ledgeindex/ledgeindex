import { Container } from "@/components/ui/container";
import { Eyebrow } from "@/components/ui/section-badge";

const FOOTER_LINKS = {
  Product: [
    { href: "#use-cases", label: "Use cases" },
    { href: "#showcase", label: "How it works" },
    { href: "#", label: "Request demo" },
  ],
  Company: [
    { href: "#", label: "Contact" },
    { href: "#", label: "Privacy" },
    { href: "#", label: "Terms" },
  ],
} as const;

export function SiteFooter() {
  return (
    <footer className="border-t border-border bg-background">
      <Container className="py-10 sm:py-14">
        <div className="flex flex-col items-center gap-8 text-center sm:flex-row sm:items-start sm:justify-between sm:gap-10 sm:text-left">
          <div className="max-w-xs">
            <span className="font-mono text-xs font-semibold tracking-[0.18em] text-muted uppercase">
              LedgeIndex
            </span>
            <p className="mt-3 text-sm leading-6 text-muted">
              Knowledge infrastructure for AI agents. Ingest docs, code, and
              APIs; serve grounded answers through SDK, API, and MCP.
            </p>
          </div>

          <div className="flex flex-wrap justify-center gap-x-10 gap-y-8 text-sm sm:justify-start sm:gap-x-14">
            {Object.entries(FOOTER_LINKS).map(([group, links]) => (
              <div key={group} className="flex flex-col gap-2.5">
                <Eyebrow>{group}</Eyebrow>
                {links.map((link) => (
                  <a
                    key={link.label}
                    href={link.href}
                    className="text-muted transition-colors hover:text-foreground"
                  >
                    {link.label}
                  </a>
                ))}
              </div>
            ))}
          </div>
        </div>

        <div className="mt-12 flex flex-col items-center justify-between gap-3 border-t border-border pt-6 sm:flex-row">
          <p className="text-xs text-muted" suppressHydrationWarning>
            © 2026 LedgeIndex. All rights reserved.
          </p>
          <p className="font-mono text-[10px] tracking-wide text-muted uppercase">
            Knowledge infrastructure for AI agents
          </p>
        </div>
      </Container>
    </footer>
  );
}
