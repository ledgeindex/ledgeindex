import { Container } from "@/components/ui/container";
import { SectionBadge } from "@/components/ui/section-badge";

const CHIPS = [
  "One URL",
  "Page summary",
  "Examples",
  "Key facts",
] as const;

export function PinpointKnowledgeSection() {
  return (
    <section
      id="pinpoint"
      aria-label="Pinpoint knowledge"
      className="relative overflow-hidden border-b border-border/60 py-10 sm:py-14"
    >
      <div aria-hidden className="section-glow-warm pointer-events-none absolute inset-0" />

      <Container className="relative">
        <div className="grid items-center gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-12">
          <div className="relative order-2 lg:order-1">
            <PinpointIso />
            <EnrichmentOutputCard />
          </div>

          <div className="order-1 lg:order-2">
            <SectionBadge>Pinpoint knowledge</SectionBadge>
            <h2 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
              Just the page someone needs
            </h2>
            <p className="mt-3 max-w-lg text-sm leading-6 text-muted sm:text-base sm:leading-7">
              Point at one docs URL and get a short summary, examples, and the
              facts that matter. No noise from the rest of the site.
            </p>

            <div className="mt-5 flex flex-wrap gap-1.5">
              {CHIPS.map((chip) => (
                <span
                  key={chip}
                  className="rounded-md border border-border bg-surface-raised px-2.5 py-1 font-mono text-[0.625rem] font-semibold tracking-[0.1em] text-muted-strong uppercase"
                >
                  {chip}
                </span>
              ))}
            </div>

            <p className="mt-5 overflow-x-auto rounded-xl border border-border bg-card-solid px-3 py-2.5 font-mono text-[0.6875rem] leading-5 text-muted shadow-card sm:px-4 sm:text-xs">
              <span className="text-muted/70">$</span>{" "}
              <span className="text-foreground">
                enrichPage(&quot;https://docs.example.com/auth/tokens&quot;)
              </span>
            </p>
          </div>
        </div>
      </Container>
    </section>
  );
}

/* ── Sample enrichment packet: summary + examples from one URL ── */

function EnrichmentOutputCard() {
  return (
    <article className="relative z-10 mx-auto -mt-8 w-full max-w-xs overflow-hidden rounded-2xl border border-border bg-card-solid shadow-card sm:absolute sm:right-0 sm:bottom-4 sm:mx-0 sm:mt-0 lg:-right-1">
      <span
        aria-hidden
        className="paper-accent-bar absolute inset-x-0 top-0 h-0.5"
      />
      <div className="flex items-center justify-between gap-2 border-b border-border/70 px-3.5 py-2">
        <span className="font-mono text-[0.5625rem] font-semibold tracking-[0.12em] text-muted-strong uppercase">
          enrich · output
        </span>
        <span className="rounded border border-border bg-surface-raised px-1.5 py-0.5 font-mono text-[0.5rem] font-semibold tracking-[0.08em] text-accent uppercase">
          1 url
        </span>
      </div>
      <div className="space-y-2.5 px-3.5 py-3 font-mono text-[0.625rem] leading-relaxed">
        <div>
          <p className="text-muted">page_summary</p>
          <p className="mt-0.5 text-foreground">
            &quot;Rotate API tokens from the dashboard. Scoped keys expire in
            90 days.&quot;
          </p>
        </div>
        <div>
          <p className="text-muted">extracted_examples</p>
          <div className="mt-1 space-y-1.5">
            <div className="rounded-lg border border-border bg-surface-raised/70 px-2.5 py-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-foreground">Create scoped token</span>
                <span className="rounded px-1 py-0.5 text-[0.5rem] tracking-[0.08em] text-muted-strong uppercase">
                  usage
                </span>
              </div>
              <p className="mt-0.5 text-[0.5625rem] text-muted">ts · POST /v1/tokens</p>
            </div>
            <div className="rounded-lg border border-border bg-surface-raised/70 px-2.5 py-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-foreground">Revoke token</span>
                <span className="rounded px-1 py-0.5 text-[0.5rem] tracking-[0.08em] text-muted-strong uppercase">
                  api
                </span>
              </div>
              <p className="mt-0.5 text-[0.5625rem] text-muted">curl · DELETE /v1/tokens/:id</p>
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}

/* ── 3D docs page facing the viewer, with a highlighted pinpoint section ── */

function PinpointIso() {
  return (
    <div
      aria-hidden
      className="mx-auto flex h-72 w-full max-w-sm items-center justify-center sm:h-[24rem] [perspective:1500px]"
    >
      <div
        className="showcase-plate-float relative h-60 w-44 sm:h-72 sm:w-52 [transform-style:preserve-3d]"
        style={{ transform: "rotateY(18deg) rotateX(8deg) rotateZ(-1deg)" }}
      >
        {/* floor shadow */}
        <span className="absolute -bottom-6 left-[8%] right-[-8%] h-8 rounded-[100%] bg-black/20 blur-xl dark:bg-black/45" />

        {/* pages behind (fanned sheets) */}
        <div
          className="absolute inset-0 rounded-lg border border-border/70 bg-[#efeae2] shadow-sm dark:bg-[#262425]"
          style={{ transform: "translateZ(-16px) rotateZ(4deg)" }}
        />
        <div
          className="absolute inset-0 rounded-lg border border-border/80 bg-[#f5f1e9] shadow-sm dark:bg-[#2a2829]"
          style={{ transform: "translateZ(-8px) rotateZ(2deg)" }}
        />

        {/* the docs page */}
        <div
          className="absolute inset-0 overflow-hidden rounded-lg border border-border bg-card-solid shadow-[0_16px_40px_rgb(0_0_0/0.18)]"
          style={{ transform: "translateZ(0px)" }}
        >
          <div className="flex h-full flex-col gap-1.5 p-3.5 sm:p-4">
            {/* page header */}
            <span className="font-mono text-[0.5rem] tracking-[0.1em] text-muted uppercase">
              docs.example.com/auth/tokens
            </span>
            <span className="mt-1 h-2 w-3/5 rounded-sm bg-foreground/60" />

            {/* muted body */}
            <span className="mt-2 h-1 w-full rounded-sm bg-muted/35" />
            <span className="h-1 w-11/12 rounded-sm bg-muted/35" />
            <span className="h-1 w-4/5 rounded-sm bg-muted/30" />

            {/* pinpoint highlight: the extracted section */}
            <div
              className="relative mt-2 rounded-md border border-amber-600/40 p-2"
              style={{
                background:
                  "linear-gradient(135deg, rgb(196 170 120 / 0.28), rgb(168 140 90 / 0.16), rgb(100 120 140 / 0.14))",
              }}
            >
              <span className="absolute -top-2 right-2 rounded border border-border bg-card-solid px-1 py-px font-mono text-[0.4375rem] font-bold tracking-[0.12em] text-muted-strong uppercase shadow-card">
                pin
              </span>
              <span className="block h-1.5 w-1/2 rounded-sm bg-foreground/55" />
              <span className="mt-1.5 block h-1 w-full rounded-sm bg-foreground/30" />
              <span className="mt-1 block h-1 w-10/12 rounded-sm bg-foreground/30" />
              <span className="mt-1.5 block w-fit rounded bg-black/10 px-1 py-0.5 font-mono text-[0.4375rem] text-muted-strong dark:bg-white/10">
                POST /v1/tokens
              </span>
            </div>

            {/* more muted body */}
            <span className="mt-2 h-1 w-full rounded-sm bg-muted/30" />
            <span className="h-1 w-10/12 rounded-sm bg-muted/30" />
            <span className="h-1 w-3/5 rounded-sm bg-muted/25" />
            <span className="mt-auto h-1 w-2/5 rounded-sm bg-muted/25" />
          </div>
        </div>

        {/* floating URL chip above the page */}
        <span
          className="absolute -top-3 left-1/2 z-10 -translate-x-1/2 rounded-md border border-border bg-card-solid px-2 py-0.5 font-mono text-[0.5rem] font-bold tracking-[0.1em] whitespace-nowrap text-muted-strong uppercase shadow-card"
          style={{ transform: "translateZ(28px)" }}
        >
          target url
        </span>
      </div>
    </div>
  );
}
