import { Container } from "@/components/ui/container";
import { SectionBadge } from "@/components/ui/section-badge";

const CHIPS = ["Repo + docs", "Picker or all", "One answer", "Cited"] as const;

export function AskAcrossSection() {
  return (
    <section
      id="ask-across"
      aria-label="Ask across sources"
      className="relative overflow-hidden border-b border-border/60 py-10 sm:py-14"
    >
      <div aria-hidden className="section-glow-warm pointer-events-none absolute inset-0" />

      <Container className="relative">
        <div className="grid items-center gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-12">
          <div className="relative order-2 lg:order-1">
            <AskAcrossVisual />
            <AskAcrossOutputCard />
          </div>

          <div className="order-1 lg:order-2">
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <SectionBadge className="mb-0">Ask across</SectionBadge>
              <span className="rounded-md border border-accent/40 bg-accent/10 px-2 py-1 font-mono text-[0.625rem] font-semibold tracking-[0.12em] text-accent uppercase">
                New
              </span>
              <span className="rounded-md border border-border bg-surface-raised px-2 py-1 font-mono text-[0.625rem] font-semibold tracking-[0.12em] text-muted-strong uppercase">
                Beta
              </span>
            </div>
            <h2 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
              Code and docs in one answer
            </h2>
            <p className="mt-3 max-w-lg text-sm leading-6 text-muted sm:text-base sm:leading-7">
              Index a repo and its docs as separate sources, then ask across both.
              Read every pinned source, or let the picker choose which ones matter
              for the question.
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
                askAcross(&quot;how does act() work?&quot;, {"{"} sources:
                [&quot;repo&quot;, &quot;docs&quot;], sourceMode: &quot;all&quot; {"}"})
              </span>
            </p>
          </div>
        </div>
      </Container>
    </section>
  );
}

function AskAcrossOutputCard() {
  return (
    <article className="relative z-10 mx-auto -mt-8 w-full max-w-xs overflow-hidden rounded-2xl border border-border bg-card-solid shadow-card sm:absolute sm:right-0 sm:bottom-4 sm:mx-0 sm:mt-0 lg:-right-1">
      <span
        aria-hidden
        className="paper-accent-bar absolute inset-x-0 top-0 h-0.5"
      />
      <div className="flex items-center justify-between gap-2 border-b border-border/70 px-3.5 py-2">
        <span className="font-mono text-[0.5625rem] font-semibold tracking-[0.12em] text-muted-strong uppercase">
          askAcross · answer
        </span>
        <span className="rounded border border-border bg-surface-raised px-1.5 py-0.5 font-mono text-[0.5rem] font-semibold tracking-[0.08em] text-accent uppercase">
          2 sources
        </span>
      </div>
      <div className="space-y-2.5 px-3.5 py-3 font-mono text-[0.625rem] leading-relaxed">
        <div>
          <p className="text-muted">read</p>
          <p className="mt-0.5 text-foreground">stagehand (code), stagehand-docs (docs)</p>
        </div>
        <div>
          <p className="text-muted">answer</p>
          <p className="mt-0.5 text-foreground">
            &quot;act() goes SDK → actService → LLM snapshot → Playwright
            click…&quot;
          </p>
        </div>
        <div>
          <p className="text-muted">citations</p>
          <div className="mt-1 space-y-1.5">
            <div className="rounded-lg border border-border bg-surface-raised/70 px-2.5 py-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-foreground">actService.ts:118</span>
                <span className="rounded px-1 py-0.5 text-[0.5rem] tracking-[0.08em] text-muted-strong uppercase">
                  code
                </span>
              </div>
            </div>
            <div className="rounded-lg border border-border bg-surface-raised/70 px-2.5 py-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-foreground">docs …/basics/act</span>
                <span className="rounded px-1 py-0.5 text-[0.5rem] tracking-[0.08em] text-muted-strong uppercase">
                  docs
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}

function AskAcrossVisual() {
  return (
    <div
      aria-hidden
      className="mx-auto flex h-72 w-full max-w-sm items-center justify-center sm:h-[24rem] [perspective:1500px]"
    >
      <div
        className="showcase-plate-float relative h-60 w-52 sm:h-72 sm:w-60 [transform-style:preserve-3d]"
        style={{ transform: "rotateY(-12deg) rotateX(6deg)" }}
      >
        <span className="absolute -bottom-6 left-[8%] right-[-8%] h-8 rounded-[100%] bg-black/20 blur-xl dark:bg-black/45" />

        {/* repo source card */}
        <div
          className="absolute top-2 left-0 w-[48%] overflow-hidden rounded-lg border border-border bg-card-solid shadow-[0_12px_28px_rgb(0_0_0/0.14)]"
          style={{ transform: "translateZ(8px) rotateZ(-3deg)" }}
        >
          <div className="border-b border-border/70 px-2 py-1.5">
            <span className="font-mono text-[0.5rem] font-semibold tracking-[0.1em] text-muted-strong uppercase">
              repo · code
            </span>
          </div>
          <div className="space-y-1 p-2.5">
            <span className="block h-1 w-4/5 rounded-sm bg-foreground/45" />
            <span className="block h-1 w-full rounded-sm bg-muted/35" />
            <span className="block h-1 w-3/4 rounded-sm bg-muted/30" />
            <span className="mt-1.5 block w-fit rounded bg-black/10 px-1 py-0.5 font-mono text-[0.4375rem] text-muted-strong dark:bg-white/10">
              actService.ts
            </span>
          </div>
        </div>

        {/* docs source card */}
        <div
          className="absolute top-6 right-0 w-[48%] overflow-hidden rounded-lg border border-border bg-card-solid shadow-[0_12px_28px_rgb(0_0_0/0.14)]"
          style={{ transform: "translateZ(16px) rotateZ(3deg)" }}
        >
          <div className="border-b border-border/70 px-2 py-1.5">
            <span className="font-mono text-[0.5rem] font-semibold tracking-[0.1em] text-muted-strong uppercase">
              docs · site
            </span>
          </div>
          <div className="space-y-1 p-2.5">
            <span className="block h-1 w-3/5 rounded-sm bg-foreground/45" />
            <span className="block h-1 w-full rounded-sm bg-muted/35" />
            <span className="block h-1 w-5/6 rounded-sm bg-muted/30" />
            <span className="mt-1.5 block w-fit rounded bg-black/10 px-1 py-0.5 font-mono text-[0.4375rem] text-muted-strong dark:bg-white/10">
              /basics/act
            </span>
          </div>
        </div>

        {/* merge rail */}
        <div
          className="absolute bottom-10 left-1/2 z-10 w-[70%] -translate-x-1/2 overflow-hidden rounded-lg border border-amber-600/40 shadow-card"
          style={{
            transform: "translateZ(28px)",
            background:
              "linear-gradient(135deg, rgb(196 170 120 / 0.28), rgb(168 140 90 / 0.16), rgb(100 120 140 / 0.14))",
          }}
        >
          <div className="flex items-center justify-between gap-2 border-b border-border/50 px-2.5 py-1.5">
            <span className="font-mono text-[0.5rem] font-bold tracking-[0.12em] text-muted-strong uppercase">
              merged hits
            </span>
            <span className="font-mono text-[0.4375rem] tracking-[0.08em] text-muted-strong uppercase">
              fair share
            </span>
          </div>
          <div className="space-y-1 px-2.5 py-2">
            <span className="block h-1 w-full rounded-sm bg-foreground/40" />
            <span className="block h-1 w-5/6 rounded-sm bg-foreground/30" />
            <span className="block h-1 w-2/3 rounded-sm bg-foreground/25" />
          </div>
        </div>

        <span
          className="absolute -top-2 left-1/2 z-10 -translate-x-1/2 rounded-md border border-border bg-card-solid px-2 py-0.5 font-mono text-[0.5rem] font-bold tracking-[0.1em] whitespace-nowrap text-muted-strong uppercase shadow-card"
          style={{ transform: "translateZ(36px)" }}
        >
          source set
        </span>
      </div>
    </div>
  );
}
