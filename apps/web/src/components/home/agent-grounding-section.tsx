import { Container } from "@/components/ui/container";

const CHIPS = ["Looks up your docs", "Shows the source", "Skips weak matches"] as const;

const HITS = [
  { title: "Agents — Tool calling", url: "docs.mastra.ai/agents/tools", score: 0.94 },
  { title: "MCP server setup", url: "docs.mastra.ai/mcp/server", score: 0.88 },
] as const;

export function AgentGroundingSection() {
  return (
    <section
      id="agent-grounding"
      aria-label="Grounded answers"
      className="relative overflow-hidden border-b border-border/60 py-10 sm:py-14"
    >
      <div aria-hidden className="section-glow-cool pointer-events-none absolute inset-0" />

      <Container className="relative">
        <div className="grid items-center gap-8 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.1fr)] lg:gap-12">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
              Answers you can check
            </h2>
            <p className="mt-3 max-w-lg text-sm leading-6 text-muted sm:text-base sm:leading-7">
              LedgeIndex pulls the relevant pages first, then answers from
              those. If nothing solid is in the docs, it says so instead of
              inventing a fix.
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
              <span className="text-muted/70">ask</span>{" "}
              <span className="text-foreground">
                &quot;How do agents call tools?&quot;
              </span>
            </p>
          </div>

          <div className="relative">
            <AgentGroundingVisual />
          </div>
        </div>
      </Container>
    </section>
  );
}

/* ── Standing book facing the viewer (CSS 3D) ── */

export function AgentGroundingVisual() {
  return (
    <>
      <GroundingBook />
      <EvidenceHitsCard />
    </>
  );
}

function GroundingBook() {
  return (
    <div
      aria-hidden
      className="mx-auto flex h-80 w-full max-w-md items-center justify-center sm:h-[28rem] [perspective:1600px]"
    >
      <div
        className="showcase-plate-float relative h-72 w-44 sm:h-[22rem] sm:w-56 [transform-style:preserve-3d]"
        style={{ transform: "rotateY(-32deg) rotateX(6deg)" }}
      >
        {/* floor shadow */}
        <span className="absolute -bottom-6 left-[8%] right-[-12%] h-9 rounded-[100%] bg-black/25 blur-xl dark:bg-black/50" />

        {/* page edges peeking out behind cover (right side) */}
        <div
          className="absolute inset-y-2.5 -right-2.5 w-3.5 rounded-r-[2px] border border-black/10"
          style={{
            transform: "translateZ(-4px)",
            background:
              "repeating-linear-gradient(180deg, #f7f2ea 0px, #f7f2ea 2px, #e6dfd3 2px, #e6dfd3 3px)",
          }}
        />
        <div
          className="absolute inset-y-2 -right-4.5 w-3 rounded-r-[2px] border border-black/10"
          style={{
            transform: "translateZ(-8px)",
            background:
              "repeating-linear-gradient(180deg, #f3eee6 0px, #f3eee6 2px, #ddd5c8 2px, #ddd5c8 3px)",
          }}
        />

        {/* spine */}
        <div
          className="absolute inset-y-0 left-0 w-4 rounded-l-[4px] border border-black/25"
          style={{
            transform: "rotateY(-90deg)",
            transformOrigin: "left center",
            background:
              "linear-gradient(180deg, rgb(170 145 100), rgb(115 88 52), rgb(88 102 118))",
          }}
        >
          <span className="absolute inset-y-8 left-1/2 w-px -translate-x-1/2 bg-black/20" />
        </div>

        {/* front cover */}
        <div
          className="absolute inset-0 overflow-hidden rounded-md rounded-l-sm border border-black/20 shadow-[0_18px_40px_rgb(0_0_0/0.28)]"
          style={{
            transform: "translateZ(1px)",
            background:
              "linear-gradient(155deg, rgb(196 170 120) 0%, rgb(140 115 75) 42%, rgb(100 120 140) 100%)",
          }}
        >
          <div className="flex h-full flex-col p-4 text-white sm:p-5">
            <span className="font-mono text-[0.5625rem] font-bold tracking-[0.14em] uppercase opacity-80">
              ledgeindex
            </span>
            <p className="mt-8 text-sm font-semibold leading-6 tracking-tight sm:mt-10 sm:text-base sm:leading-7">
              Grounded evidence
              <br />
              for your agents
            </p>
            <div className="mt-5 space-y-2 opacity-75">
              <span className="block h-1.5 w-4/5 rounded-full bg-white/35" />
              <span className="block h-1.5 w-3/5 rounded-full bg-white/25" />
              <span className="block h-1.5 w-2/3 rounded-full bg-white/20" />
            </div>
            <div className="mt-auto flex flex-col gap-2.5">
              <span className="w-fit rounded border border-white/25 bg-black/15 px-2 py-0.5 font-mono text-[0.5625rem] font-semibold tracking-[0.1em] uppercase">
                ask_source
              </span>
              <span className="font-mono text-[0.5625rem] tracking-[0.08em] uppercase opacity-70">
                sdk · rest · mcp
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Sample evidence packet: pruned hits with url + title + score ── */

function EvidenceHitsCard() {
  return (
    <article className="relative z-10 mx-auto -mt-2 w-full max-w-sm overflow-hidden rounded-2xl border border-border bg-card-solid shadow-card sm:absolute sm:right-0 sm:bottom-4 sm:left-auto sm:mx-0 sm:mt-0 lg:-right-1">
      <span aria-hidden className="paper-accent-bar absolute inset-x-0 top-0 h-0.5" />
      <div className="flex items-center justify-between gap-2 border-b border-border/70 px-4 py-2.5">
        <span className="font-mono text-[0.625rem] font-semibold tracking-[0.12em] text-muted-strong uppercase">
          Sources used
        </span>
        <span className="rounded border border-border bg-surface-raised px-1.5 py-0.5 font-mono text-[0.5625rem] font-semibold tracking-[0.08em] text-accent uppercase">
          Linked
        </span>
      </div>
      <div className="space-y-2 px-4 py-3.5">
        {HITS.map((hit) => (
          <div
            key={hit.url}
            className="rounded-lg border border-border bg-surface-raised/70 px-3 py-2"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="truncate font-mono text-xs text-foreground">
                {hit.title}
              </span>
              <span className="shrink-0 font-mono text-[0.625rem] font-semibold text-muted-strong">
                {hit.score.toFixed(2)}
              </span>
            </div>
            <p className="mt-0.5 truncate font-mono text-[0.625rem] text-muted">
              {hit.url}
            </p>
          </div>
        ))}
        <p className="pt-1 font-mono text-[0.625rem] leading-4 text-muted">
          insufficient: <span className="text-foreground">false</span> · hits
          above threshold only
        </p>
      </div>
    </article>
  );
}
