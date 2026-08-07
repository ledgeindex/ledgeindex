import { Button } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { SectionBadge } from "@/components/ui/section-badge";
import {
  FADED_TOP,
  FADED_WALL,
  GRADIENT_PLATE_PROPS,
  PLATE_TOP,
  PLATE_WALL,
  Plate,
} from "@/components/home/iso-plate";

const ENGINE_CHIPS = ["Read docs", "Find pages", "Show sources"] as const;
const SHIP_CHIPS = ["Chat widget", "~30 min", "Your docs"] as const;
const BUILD_CHIPS = ["Your tools", "Your UI", "Same knowledge"] as const;

export function AcceleratorSection() {
  return (
    <section
      id="accelerator"
      className="relative overflow-hidden border-b border-border/60 py-12 sm:py-16"
    >
      <div aria-hidden className="section-glow-warm pointer-events-none absolute inset-0" />
      <Container className="relative">
        <div className="mx-auto max-w-2xl text-center">
          <SectionBadge>LedgeIndex Accelerator</SectionBadge>
          <h2 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl lg:text-4xl">
            Ready-made chat, or your own
          </h2>
          <p className="mt-3 text-sm leading-6 text-muted sm:text-base">
            Put answers in front of users fast, or build something custom on the
            same docs knowledge.
          </p>
        </div>

        <div className="mt-9 grid items-center gap-6 sm:mt-11 lg:grid-cols-[minmax(0,1fr)_5rem_minmax(0,1.25fr)] lg:gap-0">
          {/* the engine */}
          <article className="relative overflow-hidden rounded-2xl border border-border bg-card-solid shadow-card">
            <span
              aria-hidden
              className="paper-accent-bar absolute inset-x-0 top-0 h-0.5"
            />
            <div className="flex flex-col items-center p-5 text-center sm:p-6">
              <p className="font-mono text-[0.625rem] font-semibold tracking-[0.14em] text-muted uppercase">
                Your docs knowledge
              </p>
              <EngineCoreIso />
              <div className="mt-3 flex flex-wrap justify-center gap-1.5">
                {ENGINE_CHIPS.map((chip) => (
                  <span
                    key={chip}
                    className="rounded-md border border-border bg-surface-raised px-2 py-0.5 font-mono text-[0.5625rem] font-semibold tracking-[0.1em] text-muted-strong uppercase"
                  >
                    {chip}
                  </span>
                ))}
              </div>
            </div>
          </article>

          {/* fork connector (desktop only) */}
          <ForkConnector className="hidden h-56 w-full lg:block" />

          {/* two paths */}
          <div className="grid gap-4">
            <article className="group relative overflow-hidden rounded-2xl border border-border bg-card-solid shadow-card ring-1 ring-accent/15 transition-shadow hover:shadow-lg">
              <div className="grid items-center gap-4 p-4 sm:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] sm:p-5">
                <div>
                  <p className="font-mono text-[0.625rem] font-semibold tracking-[0.14em] text-accent uppercase">
                    Path 1 · Ship it
                  </p>
                  <h3 className="mt-1.5 text-lg font-semibold tracking-tight text-foreground">
                    Drop in the chat
                  </h3>
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    {SHIP_CHIPS.map((chip) => (
                      <span
                        key={chip}
                        className="rounded-md border border-border bg-surface-raised px-2 py-0.5 font-mono text-[0.5625rem] font-semibold tracking-[0.1em] text-muted-strong uppercase"
                      >
                        {chip}
                      </span>
                    ))}
                  </div>
                  <Button href="#" className="mt-4 h-9 px-4 text-xs sm:text-sm">
                    Get the starter kit
                  </Button>
                </div>
                <WidgetOnSiteMock />
              </div>
            </article>

            <article className="group relative overflow-hidden rounded-2xl border border-border bg-card-solid shadow-card transition-shadow hover:shadow-lg">
              <div className="grid items-center gap-4 p-4 sm:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] sm:p-5">
                <div>
                  <p className="font-mono text-[0.625rem] font-semibold tracking-[0.14em] text-muted uppercase">
                    Path 2 · Build custom
                  </p>
                  <h3 className="mt-1.5 text-lg font-semibold tracking-tight text-foreground">
                    Build on the same knowledge
                  </h3>
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    {BUILD_CHIPS.map((chip) => (
                      <span
                        key={chip}
                        className="rounded-md border border-border bg-surface-raised px-2 py-0.5 font-mono text-[0.5625rem] font-semibold tracking-[0.1em] text-muted-strong uppercase"
                      >
                        {chip}
                      </span>
                    ))}
                  </div>
                  <Button
                    href="#open-source"
                    variant="secondary"
                    className="mt-4 h-9 px-4 text-xs sm:text-sm"
                  >
                    Build custom instead
                  </Button>
                </div>
                <CodeSnippet />
              </div>
            </article>
          </div>
        </div>
      </Container>
    </section>
  );
}

/** Isometric engine core: gradient rim + IDX plate over faded bases. */
function EngineCoreIso() {
  return (
    <div
      aria-hidden
      className="mt-2 flex h-44 w-full items-center justify-center sm:h-52 [perspective:1200px]"
    >
      <div className="relative size-28 sm:size-32 [transform-style:preserve-3d] [transform:rotateX(58deg)_rotateZ(-45deg)]">
        {/* ground shadow */}
        <span
          aria-hidden
          className="absolute -inset-4 rounded-[1.5rem] bg-black/15 blur-xl dark:bg-black/40"
          style={{ transform: "translateZ(-70px)" }}
        />

        <Plate
          z={-52}
          thickness={10}
          grow={12}
          topClassName={FADED_TOP}
          wallClassName={FADED_WALL}
          floatDelay="1.1s"
        />
        <Plate
          z={-26}
          thickness={9}
          grow={6}
          topClassName={FADED_TOP}
          wallClassName={FADED_WALL}
          floatDelay="0.7s"
        />
        <Plate z={2} thickness={9} grow={3} floatDelay="0.35s" {...GRADIENT_PLATE_PROPS} />
        <Plate
          z={36}
          thickness={13}
          topClassName={cnPlateTop}
          wallClassName={PLATE_WALL}
          floatDelay="0s"
        >
          <div className="flex h-full flex-col items-center justify-center gap-1">
            <span className="flex size-8 items-center justify-center rounded-md border border-border bg-surface-raised font-mono text-[0.5625rem] font-bold tracking-[0.08em] text-foreground sm:size-9">
              IDX
            </span>
            <span className="font-mono text-[0.4375rem] font-semibold tracking-[0.14em] text-accent uppercase">
              one index
            </span>
          </div>
        </Plate>
      </div>
    </div>
  );
}

const cnPlateTop = `${PLATE_TOP} overflow-hidden shadow-lg`;

/** Path 1 visual: the widget floating over a mock page on your site. */
function WidgetOnSiteMock() {
  return (
    <div
      aria-hidden
      className="relative overflow-hidden rounded-xl border border-border bg-background shadow-sm"
    >
      {/* browser chrome */}
      <div className="flex items-center gap-1.5 border-b border-border bg-surface-raised px-3 py-2">
        <span className="size-1.5 rounded-full bg-muted/40" />
        <span className="size-1.5 rounded-full bg-muted/40" />
        <span className="ml-1 flex-1 rounded-sm bg-card-solid px-2 py-0.5 font-mono text-[0.5rem] text-muted">
          yourproduct.com/docs
        </span>
      </div>

      {/* page skeleton */}
      <div className="space-y-1.5 p-3 pb-16">
        <span className="block h-2 w-2/5 rounded-sm bg-muted/35" />
        <span className="block h-1.5 w-full rounded-sm bg-muted/20" />
        <span className="block h-1.5 w-11/12 rounded-sm bg-muted/20" />
        <span className="block h-1.5 w-3/5 rounded-sm bg-muted/20" />
      </div>

      {/* floating widget */}
      <div className="absolute right-2 bottom-2 w-[78%] max-w-[13rem] overflow-hidden rounded-lg border border-border bg-card-solid shadow-card">
        <div className="flex items-center gap-1.5 border-b border-border bg-surface-raised px-2.5 py-1.5">
          <span className="size-1.5 rounded-full bg-gradient-to-br from-amber-600 to-slate-500" />
          <span className="font-mono text-[0.5rem] font-semibold tracking-[0.1em] text-muted uppercase">
            Ask the docs
          </span>
        </div>
        <div className="space-y-1.5 p-2.5">
          <p className="text-[0.625rem] leading-4 text-foreground">
            Tokens rotate via the dashboard.
          </p>
          <p className="font-mono text-[0.5rem] tracking-wide text-accent uppercase">
            § auth · cited
          </p>
        </div>
        <span
          aria-hidden
          className="paper-accent-bar absolute inset-x-0 top-0 h-px"
        />
      </div>
    </div>
  );
}

/** Gradient fork: one line in, two lines out. */
function ForkConnector({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 80 224"
      fill="none"
      preserveAspectRatio="none"
      className={className}
    >
      <defs>
        <linearGradient id="fork-grad" x1="0" y1="0" x2="80" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#a88c5a" stopOpacity="0.3" />
          <stop offset="0.55" stopColor="#64788a" stopOpacity="0.9" />
          <stop offset="1" stopColor="#c8b496" stopOpacity="0.9" />
        </linearGradient>
      </defs>
      <path
        d="M0 112 C28 112 34 56 80 56"
        stroke="url(#fork-grad)"
        strokeWidth="1.5"
        strokeDasharray="5 4"
      />
      <path
        d="M0 112 C28 112 34 168 80 168"
        stroke="url(#fork-grad)"
        strokeWidth="1.5"
        strokeDasharray="5 4"
      />
      <circle cx="80" cy="56" r="3" fill="#a88c5a" />
      <circle cx="80" cy="168" r="3" fill="#64788a" />
    </svg>
  );
}

/** Tiny SDK mock for the build-custom path. */
function CodeSnippet() {
  return (
    <div
      aria-hidden
      className="overflow-hidden rounded-xl border border-border bg-background shadow-sm"
    >
      <div className="flex items-center gap-1.5 border-b border-border bg-surface-raised px-3 py-2">
        <span className="size-1.5 rounded-full bg-muted/40" />
        <span className="size-1.5 rounded-full bg-muted/40" />
        <span className="font-mono text-[0.5rem] tracking-[0.12em] text-muted uppercase">
          your-agent.ts
        </span>
      </div>
      <pre className="p-3 font-mono text-[0.625rem] leading-5 sm:text-[0.6875rem]">
        <code>
          <span className="text-muted">const</span>{" "}
          <span className="text-foreground">ctx</span>{" "}
          <span className="text-muted">= await</span>{" "}
          <span className="text-accent">ledge</span>
          <span className="text-muted">.query(</span>
          {"\n"}
          <span className="text-muted">{"  "}</span>
          <span className="text-foreground">&quot;webhook retries&quot;</span>
          <span className="text-muted">,</span>{" "}
          <span className="text-muted">{"{ cited: true }"}</span>
          {"\n"}
          <span className="text-muted">)</span>
          {"\n\n"}
          <span className="text-muted">{"// answers with links · yours"}</span>
        </code>
      </pre>
    </div>
  );
}
