import { Laptop, Package, Server } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { Eyebrow, SectionBadge } from "@/components/ui/section-badge";
import { cn } from "@/lib/utils";

const PILLARS = [
  {
    icon: Package,
    eyebrow: "npm packages",
    title: "Build your own apps",
    description:
      "Use the same open source pieces we run in the cloud: read docs, break them into searchable pieces, and answer from them in your own products.",
    tags: ["@ledgeindex/core", "@ledgeindex/server"],
  },
  {
    icon: Server,
    eyebrow: "Self-host",
    title: "Run it on your machines",
    description:
      "One command starts the full server on your side. Local data folder, no cloud account. Free to run.",
    tags: ["Local-first", "MCP", "Docker"],
  },
  {
    icon: Laptop,
    eyebrow: "Desktop",
    title: "The same setup on your desk",
    description:
      "A desktop app with the same dashboard and a local engine underneath. Index private docs without anything leaving your machine.",
    tags: ["Coming soon", "Offline"],
  },
] as const;

const TERMINAL_LINES = [
  { prompt: true, text: "npm install @ledgeindex/server" },
  { prompt: true, text: "LEDGEINDEX_DATA_DIR=~/.ledgeindex ledgeindex-server" },
  { prompt: false, text: "✓ docs + company profiles ready on http://localhost:3010" },
] as const;

export function SelfHostTerminal({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-2xl border border-border bg-card-solid shadow-card",
        className,
      )}
    >
      <div className="flex items-center gap-1.5 border-b border-border bg-surface-raised px-4 py-2.5">
        <span aria-hidden className="h-2 w-2 rounded-full bg-border" />
        <span aria-hidden className="h-2 w-2 rounded-full bg-border" />
        <span aria-hidden className="h-2 w-2 rounded-full bg-border" />
        <span className="ml-2 font-mono text-[0.625rem] font-semibold tracking-[0.12em] text-muted uppercase">
          Self-host in two commands
        </span>
      </div>
      <div className="space-y-1.5 overflow-x-auto p-4 font-mono text-[0.8125rem] leading-6 sm:p-5">
        {TERMINAL_LINES.map((line) => (
          <p key={line.text} className="whitespace-nowrap">
            {line.prompt ? (
              <span aria-hidden className="mr-2 select-none text-accent">
                $
              </span>
            ) : null}
            <span className={line.prompt ? "text-foreground" : "text-muted"}>
              {line.text}
            </span>
          </p>
        ))}
      </div>
    </div>
  );
}

export function OpenSourceSection() {
  return (
    <section
      id="open-source"
      className="relative overflow-hidden border-b border-border/60 py-12 sm:py-16 lg:py-20"
    >
      <div aria-hidden className="section-glow-cool pointer-events-none absolute inset-0" />
      <span
        aria-hidden
        className="paper-accent-fade absolute inset-x-0 top-0 h-px"
      />
      <Container className="relative">
        <div className="mx-auto max-w-2xl text-center">
          <SectionBadge>Open source</SectionBadge>
          <h2 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl lg:text-4xl">
            Free to run yourself. Same product as the cloud.
          </h2>
          <p className="mt-3 text-sm leading-6 text-muted sm:mt-4 sm:text-base sm:leading-7">
            Host it yourself, drop the packages into your own apps, or wait for
            the desktop app. The hosted platform is the same code with managed
            hosting on top.
          </p>
        </div>

        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 lg:gap-6">
          {PILLARS.map((pillar) => (
            <article
              key={pillar.title}
              className="group relative flex flex-col overflow-hidden rounded-2xl border border-border bg-card-solid p-5 shadow-card transition-all duration-300 hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-lg sm:p-6"
            >
              <span
                aria-hidden
                className="paper-accent-bar absolute inset-x-0 top-0 h-0.5 origin-left scale-x-0 transition-transform duration-300 group-hover:scale-x-100"
              />
              <pillar.icon
                aria-hidden
                className="h-5 w-5 text-accent"
                strokeWidth={1.75}
              />
              <Eyebrow className="mt-4 text-[0.625rem]">{pillar.eyebrow}</Eyebrow>
              <h3 className="mt-1 text-lg font-semibold text-foreground">
                {pillar.title}
              </h3>
              <p className="mt-2 flex-1 text-sm leading-6 text-muted">
                {pillar.description}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                {pillar.tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-md border border-border bg-surface-raised px-2.5 py-1 font-mono text-[0.625rem] font-semibold tracking-[0.1em] text-muted-strong uppercase"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </article>
          ))}
        </div>

        <SelfHostTerminal className="mx-auto mt-8 max-w-2xl sm:mt-10" />

        <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
          <Button href="https://github.com/ledgeindex" className="w-full sm:w-auto">
            Star on GitHub
          </Button>
          <Button href="#faq" variant="secondary" className="w-full sm:w-auto">
            Self-hosting docs
          </Button>
        </div>

        <p className="mx-auto mt-6 max-w-2xl text-center text-xs leading-5 text-muted sm:text-sm sm:leading-6">
          Fair-code licensed: free to self-host and build on for your own
          products. Running LedgeIndex as a hosted service for others is
          reserved for our cloud.
        </p>
      </Container>
    </section>
  );
}
