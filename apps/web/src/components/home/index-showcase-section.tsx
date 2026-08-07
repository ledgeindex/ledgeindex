import { Container } from "@/components/ui/container";
import { SectionBadge } from "@/components/ui/section-badge";
import { cn } from "@/lib/utils";

export function IndexShowcaseSection() {
  return (
    <section
      id="showcase"
      aria-label="Docs assistant and support help"
      className="relative overflow-hidden border-b border-border/60 py-12 sm:py-16 lg:py-20"
    >
      <div
        aria-hidden
        className="section-glow-cool pointer-events-none absolute inset-0"
      />
      <div
        aria-hidden
        className="showcase-aurora pointer-events-none absolute inset-0"
      />

      <Container className="relative">
        <div className="mx-auto mb-6 max-w-2xl text-center sm:mb-8">
          <SectionBadge>What you ship</SectionBadge>
          <h2 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl lg:text-4xl">
            Answers where people get stuck
          </h2>
        </div>

        <DeflectorShieldVisual />

        <div className="grid gap-5 lg:grid-cols-2 lg:gap-6">
          {/* ── Docs & API copilot ── */}
          <article className="flex flex-col overflow-hidden rounded-3xl border border-border/70 bg-card-solid/60 shadow-card">
            <div className="flex-1 px-6 pt-6 sm:px-7 sm:pt-7">
              <h3 className="text-lg font-semibold tracking-tight text-foreground sm:text-xl">
                Docs assistant
              </h3>
              <p className="mt-2 max-w-md text-sm leading-6 text-muted sm:text-[0.9375rem] sm:leading-7">
                Put a chat on your docs site or in your product. Every reply
                points back to the page it came from, so people can trust it.
              </p>
            </div>
            <CopilotMock />
          </article>

          {/* ── Support deflection ── */}
          <article className="flex flex-col overflow-hidden rounded-3xl border border-border/70 bg-card-solid/60 shadow-card">
            <div className="flex-1 px-6 pt-6 sm:px-7 sm:pt-7">
              <h3 className="text-lg font-semibold tracking-tight text-foreground sm:text-xl">
                Less repeat support work
              </h3>
              <p className="mt-2 max-w-md text-sm leading-6 text-muted sm:text-[0.9375rem] sm:leading-7">
                Questions your docs already answer get handled before they
                become tickets. The rest arrive with the relevant pages attached.
              </p>
            </div>
            <DeflectionMock />
          </article>
        </div>
      </Container>
    </section>
  );
}

/* ── Deflector shield: tickets fly in from the top right, the copilot
     shield bounces the answerable ones away as resolved, and the one it
     can't answer passes through the gap to a human. ───────────────── */

/** Segment angles around the shield arc; the gap at 0° is the escape route. */
const SHIELD_SEGMENTS = [-68, -52, -36, -20, 20, 36, 52, 68];

function DeflectorShieldVisual() {
  return (
    <div
      aria-hidden
      className="mx-auto mb-8 flex h-60 w-full max-w-xl items-center justify-center sm:mb-10 sm:h-72"
    >
      <div className="relative h-56 w-[21rem] sm:h-64 sm:w-[26rem]">
        {/* incoming ticket trajectories */}
        <span className="absolute top-[28%] left-[46%] h-px w-28 origin-left -rotate-[32deg] border-t border-dashed border-border" />
        <span className="absolute top-[44%] left-[52%] h-px w-24 origin-left -rotate-[20deg] border-t border-dashed border-border" />

        {/* ricochet trajectories — deflected, answered by the docs */}
        <span className="absolute top-[62%] left-[50%] h-px w-24 origin-left rotate-[26deg] border-t border-dashed border-emerald-500/50" />
        <span className="absolute top-[70%] left-[46%] h-px w-16 origin-left rotate-[40deg] border-t border-dashed border-emerald-500/40" />

        {/* the one that gets through the gap, out to a person */}
        <span className="absolute top-1/2 left-[6%] h-px w-[26%] border-t border-dashed border-amber-600/70" />

        {/* the shield itself */}
        <div className="absolute top-1/2 left-[34%]">
          {SHIELD_SEGMENTS.map((angle) => (
            <span
              key={angle}
              className="absolute top-0 left-0"
              style={{ transform: `rotate(${angle}deg) translateX(92px)` }}
            >
              <span className="relative block h-9 w-[7px] -translate-x-1/2 -translate-y-1/2">
                {/* extruded side face */}
                <span className="absolute inset-x-0 top-1.5 -bottom-1 rounded-full bg-slate-400/70 dark:bg-stone-600/70" />
                {/* front face */}
                <span className="absolute inset-0 rounded-full border border-foreground/25 bg-gradient-to-b from-amber-700/80 via-slate-500 to-stone-400" />
              </span>
            </span>
          ))}

          {/* copilot core behind the shield */}
          <span className="absolute top-0 left-0 -translate-x-1/2 -translate-y-1/2">
            <span className="flex size-11 items-center justify-center rounded-xl border border-foreground/20 bg-card-solid font-mono text-[0.5rem] font-bold tracking-[0.08em] text-foreground shadow-sm sm:size-12">
              IDX
            </span>
          </span>
          <span className="absolute top-9 left-0 -translate-x-1/2 rounded border border-border bg-card-solid px-1.5 py-0.5 font-mono text-[0.4375rem] font-bold tracking-[0.12em] whitespace-nowrap text-muted uppercase shadow-sm">
            Copilot
          </span>
        </div>

        {/* incoming tickets, top right */}
        <TicketCard id="#4821" className="top-0 right-[1%]" />
        <TicketCard id="#4822" className="top-[15%] right-[14%]" />
        <TicketCard id="#4823" className="top-[30%] right-[27%]" faded />

        {/* deflected — answered straight from the docs */}
        <ResolvedTile className="right-[5%] bottom-[3%]" label="Answered" />
        <ResolvedTile className="right-[27%] bottom-[12%]" />

        {/* escalated — reaches a person, with the evidence attached */}
        <div className="absolute top-1/2 left-0 -translate-y-1/2">
          <div className="flex flex-col items-center gap-1">
            <span className="relative block size-9 sm:size-10">
              <span className="absolute inset-x-[30%] top-0 aspect-square rounded-full border border-foreground/25 bg-card-solid" />
              <span className="absolute inset-x-0 bottom-0 h-[45%] rounded-t-full border border-b-0 border-foreground/25 bg-card-solid" />
            </span>
            <span className="font-mono text-[0.4375rem] font-bold tracking-[0.12em] text-muted uppercase">
              Human
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Small ticket stub: ref number over two detail bars. */
function TicketCard({
  id,
  className,
  faded = false,
}: {
  id: string;
  className?: string;
  faded?: boolean;
}) {
  return (
    <div
      className={cn(
        "absolute w-16 sm:w-[4.5rem]",
        faded && "opacity-60",
        className,
      )}
    >
      <div className="relative">
        <span className="absolute inset-x-0 top-1.5 -bottom-1 rounded-md bg-slate-300/70 dark:bg-stone-700/70" />
        <div className="relative rounded-md border border-foreground/20 bg-card-solid px-2 py-1.5">
          <span className="block font-mono text-[0.5rem] font-bold tracking-[0.08em] text-muted-strong">
            {id}
          </span>
          <span className="mt-1 block h-1 w-4/5 rounded-full bg-border" />
          <span className="mt-0.5 block h-1 w-3/5 rounded-full bg-border/70" />
        </div>
      </div>
    </div>
  );
}

/** Deflected ticket: a check tile that never reached a human. */
function ResolvedTile({
  className,
  label,
}: {
  className?: string;
  label?: string;
}) {
  return (
    <div className={cn("absolute", className)}>
      <div className="relative">
        <span className="absolute inset-x-0 top-1.5 -bottom-1 rounded-md bg-emerald-700/25" />
        <div className="relative flex flex-col items-center gap-0.5 rounded-md border border-emerald-600/35 bg-emerald-500/10 px-2 py-1.5">
          <span className="text-[0.6875rem] leading-none font-bold text-emerald-600 dark:text-emerald-400">
            ✓
          </span>
          {label ? (
            <span className="font-mono text-[0.4375rem] font-bold tracking-[0.1em] text-emerald-700 uppercase dark:text-emerald-400">
              {label}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/* ── Visual 1: copilot chat window with a cited answer ── */

function CopilotMock() {
  return (
    <div aria-hidden className="px-6 pt-6 pb-6 sm:px-7 sm:pb-7">
      <div className="overflow-hidden rounded-xl border border-border bg-background shadow-sm">
        {/* window chrome */}
        <div className="flex items-center gap-1.5 border-b border-border/70 bg-surface-raised/70 px-3 py-2">
          <span className="size-2 rounded-full bg-border" />
          <span className="size-2 rounded-full bg-border" />
          <span className="size-2 rounded-full bg-border" />
          <span className="ml-2 font-mono text-[0.5625rem] tracking-[0.1em] text-muted uppercase">
            Ask the docs
          </span>
        </div>

        <div className="space-y-3 p-4">
          {/* user question */}
          <div className="flex justify-end">
            <p className="max-w-[85%] rounded-lg rounded-br-sm border border-border bg-surface-raised px-3 py-2 text-xs leading-5 text-foreground">
              How do I rotate an API key without downtime?
            </p>
          </div>

          {/* answer with citations */}
          <div className="max-w-[92%] rounded-lg rounded-bl-sm border border-border bg-card-solid px-3 py-2.5">
            <p className="text-xs leading-5 text-foreground">
              Create a second key, roll your services over to it, then revoke
              the old one. Keys stay valid until revoked, so both work during
              the switch{" "}
              <span className="inline-flex translate-y-[-1px] items-center rounded border border-accent/30 bg-accent/10 px-1 font-mono text-[0.5rem] font-semibold text-accent">
                1
              </span>
            </p>
            <div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-border/60 pt-2">
              <span className="font-mono text-[0.5rem] font-semibold tracking-[0.1em] text-muted uppercase">
                Sources
              </span>
              <span className="inline-flex items-center gap-1 rounded-md border border-border bg-surface-raised px-1.5 py-0.5 font-mono text-[0.5625rem] text-muted-strong">
                <span className="text-accent">1</span>
                docs/api/auth/rotate-keys
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* placement chips */}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {["Docs site", "In-app", "IDE / MCP"].map((chip) => (
          <span
            key={chip}
            className="rounded-md border border-border bg-surface-raised px-2 py-0.5 font-mono text-[0.5625rem] font-semibold tracking-[0.08em] text-muted-strong uppercase"
          >
            {chip}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ── Visual 2: ticket queue, most auto-answered, one escalated ── */

const TICKETS = [
  {
    id: "#4821",
    subject: "Webhook signature keeps failing",
    status: "deflected",
    source: "docs/webhooks/verify",
  },
  {
    id: "#4822",
    subject: "How do I bulk-export my data?",
    status: "deflected",
    source: "docs/exports",
  },
  {
    id: "#4823",
    subject: "Refund for duplicate charge",
    status: "escalated",
    source: null,
  },
] as const;

function DeflectionMock() {
  return (
    <div aria-hidden className="px-6 pt-6 pb-6 sm:px-7 sm:pb-7">
      <div className="overflow-hidden rounded-xl border border-border bg-background shadow-sm">
        <div className="flex items-center justify-between border-b border-border/70 bg-surface-raised/70 px-3 py-2">
          <span className="font-mono text-[0.5625rem] tracking-[0.1em] text-muted uppercase">
            Incoming tickets
          </span>
          <span className="rounded border border-emerald-500/35 bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[0.5rem] font-semibold tracking-[0.08em] text-emerald-700 uppercase dark:text-emerald-400">
            2 / 3 answered from docs
          </span>
        </div>

        <ul className="divide-y divide-border/60">
          {TICKETS.map((ticket) => {
            const deflected = ticket.status === "deflected";
            return (
              <li
                key={ticket.id}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5",
                  deflected && "opacity-90",
                )}
              >
                <span
                  className={cn(
                    "flex size-5 shrink-0 items-center justify-center rounded-full border font-mono text-[0.5625rem] font-bold",
                    deflected
                      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                      : "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400",
                  )}
                >
                  {deflected ? "✓" : "→"}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-foreground">
                    <span className="mr-1.5 font-mono text-[0.625rem] text-muted">
                      {ticket.id}
                    </span>
                    {ticket.subject}
                  </p>
                  <p className="mt-0.5 truncate font-mono text-[0.5625rem] text-muted">
                    {deflected
                      ? `Answered · ${ticket.source}`
                      : "Sent to a person · no doc match"}
                  </p>
                </div>
                <span
                  className={cn(
                    "shrink-0 rounded-md border px-1.5 py-0.5 font-mono text-[0.5rem] font-semibold tracking-[0.08em] uppercase",
                    deflected
                      ? "border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                      : "border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-400",
                  )}
                >
                  {deflected ? "Answered" : "Human"}
                </span>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {["Answer with a link", "Hand off with context"].map((chip) => (
          <span
            key={chip}
            className="rounded-md border border-border bg-surface-raised px-2 py-0.5 font-mono text-[0.5625rem] font-semibold tracking-[0.08em] text-muted-strong uppercase"
          >
            {chip}
          </span>
        ))}
      </div>
    </div>
  );
}
